//! Unit conversion for the launcher's calculator: `10km to mi`, `100f in c`,
//! `2 hours to min`, `1 gib to mb`.
//!
//! Offline and exact, with the same stance as the rest of the crate: an answer
//! or silence, never a guess. A query converts only when it has a number, a
//! connector (`to`, `in`, `as`, `->`), and two units this table knows that
//! measure the same thing. Anything else is left to the search.
//!
//! Money is not here: rates move, so `100 usd to vnd` is answered by
//! `look-answers`, which fetches them. Time zones need a tz database and are not
//! attempted.

use crate::{Calculation, eval_value, format_display, format_raw};

/// What a unit measures. Two units convert only within one.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Dim {
    Length,
    Mass,
    Volume,
    Area,
    Speed,
    Time,
    Data,
    Temperature,
}

/// `base = value * factor + offset`, in the dimension's base unit (metre,
/// kilogram, litre, square metre, metre per second, second, byte, kelvin). The
/// offset is what makes temperatures work and is zero for everything else.
struct Unit {
    dim: Dim,
    /// What the answer is labelled with.
    symbol: &'static str,
    factor: f64,
    offset: f64,
    /// Every spelling that means this unit. Matched exactly first, so `Mb`
    /// (megabit) and `MB` (megabyte) differ; then lowercase against the
    /// all-lowercase entries, so `KM` and `Km` mean `km`.
    names: &'static [&'static str],
}

const fn u(dim: Dim, symbol: &'static str, factor: f64, names: &'static [&'static str]) -> Unit {
    Unit {
        dim,
        symbol,
        factor,
        offset: 0.0,
        names,
    }
}

const KELVIN_AT_ZERO_C: f64 = 273.15;
const FAHRENHEIT_STEP: f64 = 5.0 / 9.0;

const UNITS: &[Unit] = &[
    // Length, in metres.
    u(
        Dim::Length,
        "m",
        1.0,
        &["m", "meter", "meters", "metre", "metres"],
    ),
    u(
        Dim::Length,
        "km",
        1000.0,
        &["km", "kilometer", "kilometers", "kilometre", "kilometres"],
    ),
    u(
        Dim::Length,
        "cm",
        0.01,
        &[
            "cm",
            "centimeter",
            "centimeters",
            "centimetre",
            "centimetres",
        ],
    ),
    u(
        Dim::Length,
        "mm",
        0.001,
        &[
            "mm",
            "millimeter",
            "millimeters",
            "millimetre",
            "millimetres",
        ],
    ),
    u(
        Dim::Length,
        "µm",
        1e-6,
        &["µm", "um", "micron", "microns", "micrometer", "micrometers"],
    ),
    u(Dim::Length, "nm", 1e-9, &["nm", "nanometer", "nanometers"]),
    u(Dim::Length, "mi", 1609.344, &["mi", "mile", "miles"]),
    u(Dim::Length, "yd", 0.9144, &["yd", "yds", "yard", "yards"]),
    u(Dim::Length, "ft", 0.3048, &["ft", "foot", "feet"]),
    u(Dim::Length, "in", 0.0254, &["in", "inch", "inches"]),
    u(
        Dim::Length,
        "nmi",
        1852.0,
        &["nmi", "nautical mile", "nautical miles"],
    ),
    // Mass, in kilograms.
    u(
        Dim::Mass,
        "kg",
        1.0,
        &["kg", "kgs", "kilogram", "kilograms", "kilo", "kilos"],
    ),
    u(Dim::Mass, "g", 0.001, &["g", "gram", "grams"]),
    u(Dim::Mass, "mg", 1e-6, &["mg", "milligram", "milligrams"]),
    u(
        Dim::Mass,
        "µg",
        1e-9,
        &["µg", "ug", "microgram", "micrograms"],
    ),
    u(
        Dim::Mass,
        "t",
        1000.0,
        &["t", "tonne", "tonnes", "metric ton", "metric tons"],
    ),
    u(
        Dim::Mass,
        "lb",
        0.453_592_37,
        &["lb", "lbs", "pound", "pounds"],
    ),
    u(
        Dim::Mass,
        "oz",
        0.028_349_523_125,
        &["oz", "ounce", "ounces"],
    ),
    u(Dim::Mass, "st", 6.350_293_18, &["st", "stone", "stones"]),
    // Volume, in litres. Gallons and friends are the US ones.
    u(
        Dim::Volume,
        "L",
        1.0,
        &["l", "liter", "liters", "litre", "litres"],
    ),
    u(
        Dim::Volume,
        "mL",
        0.001,
        &[
            "ml",
            "milliliter",
            "milliliters",
            "millilitre",
            "millilitres",
        ],
    ),
    u(
        Dim::Volume,
        "cL",
        0.01,
        &[
            "cl",
            "centiliter",
            "centiliters",
            "centilitre",
            "centilitres",
        ],
    ),
    u(
        Dim::Volume,
        "m³",
        1000.0,
        &[
            "m3",
            "m³",
            "cubic meter",
            "cubic meters",
            "cubic metre",
            "cubic metres",
        ],
    ),
    u(
        Dim::Volume,
        "gal",
        3.785_411_784,
        &["gal", "gallon", "gallons"],
    ),
    u(Dim::Volume, "qt", 0.946_352_946, &["qt", "quart", "quarts"]),
    u(Dim::Volume, "pt", 0.473_176_473, &["pt", "pint", "pints"]),
    u(Dim::Volume, "cup", 0.236_588_236_5, &["cup", "cups"]),
    u(
        Dim::Volume,
        "fl oz",
        0.029_573_529_562_5,
        &["floz", "fl oz", "fluid ounce", "fluid ounces"],
    ),
    u(
        Dim::Volume,
        "tbsp",
        0.014_786_764_781_25,
        &["tbsp", "tablespoon", "tablespoons"],
    ),
    u(
        Dim::Volume,
        "tsp",
        0.004_928_921_593_75,
        &["tsp", "teaspoon", "teaspoons"],
    ),
    // Area, in square metres.
    u(
        Dim::Area,
        "m²",
        1.0,
        &[
            "m2",
            "m²",
            "sqm",
            "square meter",
            "square meters",
            "square metre",
            "square metres",
        ],
    ),
    u(
        Dim::Area,
        "km²",
        1e6,
        &[
            "km2",
            "km²",
            "sqkm",
            "square kilometer",
            "square kilometers",
        ],
    ),
    u(Dim::Area, "cm²", 1e-4, &["cm2", "cm²", "sqcm"]),
    u(Dim::Area, "ha", 10_000.0, &["ha", "hectare", "hectares"]),
    u(Dim::Area, "acre", 4_046.856_422_4, &["acre", "acres"]),
    u(
        Dim::Area,
        "ft²",
        0.092_903_04,
        &["ft2", "ft²", "sqft", "square foot", "square feet"],
    ),
    u(
        Dim::Area,
        "in²",
        0.000_645_16,
        &["in2", "in²", "sqin", "square inch", "square inches"],
    ),
    u(
        Dim::Area,
        "mi²",
        2_589_988.110_336,
        &["mi2", "mi²", "sqmi", "square mile", "square miles"],
    ),
    // Speed, in metres per second.
    u(Dim::Speed, "m/s", 1.0, &["m/s", "mps"]),
    u(
        Dim::Speed,
        "km/h",
        1.0 / 3.6,
        &["km/h", "kmh", "kph", "kmph"],
    ),
    u(Dim::Speed, "mph", 0.447_04, &["mph"]),
    u(
        Dim::Speed,
        "kn",
        1852.0 / 3600.0,
        &["kn", "kt", "knot", "knots"],
    ),
    u(Dim::Speed, "ft/s", 0.3048, &["ft/s", "fps"]),
    // Time, in seconds. No months or years: they are not one length.
    u(
        Dim::Time,
        "ms",
        0.001,
        &["ms", "millisecond", "milliseconds"],
    ),
    u(
        Dim::Time,
        "s",
        1.0,
        &["s", "sec", "secs", "second", "seconds"],
    ),
    u(
        Dim::Time,
        "min",
        60.0,
        &["min", "mins", "minute", "minutes"],
    ),
    u(Dim::Time, "h", 3600.0, &["h", "hr", "hrs", "hour", "hours"]),
    u(Dim::Time, "d", 86_400.0, &["d", "day", "days"]),
    u(Dim::Time, "wk", 604_800.0, &["wk", "wks", "week", "weeks"]),
    // Data, in bytes. Capital B is bytes, lowercase b is bits, and `Mb` is a
    // megabit where `mb` and `MB` are megabytes: the way they are written.
    u(Dim::Data, "bit", 0.125, &["bit", "bits", "b"]),
    u(Dim::Data, "B", 1.0, &["B", "byte", "bytes"]),
    u(
        Dim::Data,
        "kB",
        1e3,
        &["kb", "kB", "KB", "kilobyte", "kilobytes"],
    ),
    u(Dim::Data, "MB", 1e6, &["mb", "MB", "megabyte", "megabytes"]),
    u(Dim::Data, "GB", 1e9, &["gb", "GB", "gigabyte", "gigabytes"]),
    u(
        Dim::Data,
        "TB",
        1e12,
        &["tb", "TB", "terabyte", "terabytes"],
    ),
    u(
        Dim::Data,
        "PB",
        1e15,
        &["pb", "PB", "petabyte", "petabytes"],
    ),
    u(
        Dim::Data,
        "KiB",
        1024.0,
        &["kib", "KiB", "kibibyte", "kibibytes"],
    ),
    u(
        Dim::Data,
        "MiB",
        1_048_576.0,
        &["mib", "MiB", "mebibyte", "mebibytes"],
    ),
    u(
        Dim::Data,
        "GiB",
        1_073_741_824.0,
        &["gib", "GiB", "gibibyte", "gibibytes"],
    ),
    u(
        Dim::Data,
        "TiB",
        1_099_511_627_776.0,
        &["tib", "TiB", "tebibyte", "tebibytes"],
    ),
    u(
        Dim::Data,
        "kbit",
        125.0,
        &["Kb", "kbit", "kilobit", "kilobits"],
    ),
    u(
        Dim::Data,
        "Mbit",
        125_000.0,
        &["Mb", "mbit", "megabit", "megabits"],
    ),
    u(
        Dim::Data,
        "Gbit",
        1.25e8,
        &["Gb", "gbit", "gigabit", "gigabits"],
    ),
    u(
        Dim::Data,
        "Tbit",
        1.25e11,
        &["Tb", "tbit", "terabit", "terabits"],
    ),
    // Temperature, in kelvin.
    Unit {
        dim: Dim::Temperature,
        symbol: "°C",
        factor: 1.0,
        offset: KELVIN_AT_ZERO_C,
        names: &["c", "°c", "℃", "celsius", "degc", "deg c"],
    },
    Unit {
        dim: Dim::Temperature,
        symbol: "°F",
        factor: FAHRENHEIT_STEP,
        offset: KELVIN_AT_ZERO_C - 32.0 * FAHRENHEIT_STEP,
        names: &["f", "°f", "℉", "fahrenheit", "degf", "deg f"],
    },
    Unit {
        dim: Dim::Temperature,
        symbol: "K",
        factor: 1.0,
        offset: 0.0,
        names: &["k", "kelvin"],
    },
];

/// Words that join the two halves when they stand alone between spaces.
const WORD_CONNECTORS: &[&str] = &["to", "in", "as", "into"];
/// Symbols that join them with or without spaces.
const SYMBOL_CONNECTORS: &[&str] = &["->", "=>", "→"];

/// Longer than this is prose.
const MAX_LEN: usize = 80;
/// Digits an answer keeps: enough for `6.213712 mi`, too few to show float noise.
const SIGNIFICANT_DIGITS: i32 = 7;

fn find_unit(text: &str) -> Option<&'static Unit> {
    // `fl  oz` and `fl oz` are one unit.
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let text = text.trim_end_matches('.');
    if text.is_empty() {
        return None;
    }
    if let Some(unit) = UNITS.iter().find(|unit| unit.names.contains(&text)) {
        return Some(unit);
    }
    let lower = text.to_lowercase();
    UNITS.iter().find(|unit| {
        unit.names
            .iter()
            .any(|name| *name == lower && name.chars().all(|c| !c.is_uppercase()))
    })
}

/// What a trailing number may end in before its unit starts: `10 km`, `10km`,
/// `(2+3) m`, `50% c`.
fn ends_a_number(prefix: &str) -> bool {
    prefix
        .chars()
        .next_back()
        .is_some_and(|c| c.is_ascii_digit() || matches!(c, '.' | ')' | '%' | '!'))
}

fn starts_a_unit(rest: &str) -> bool {
    rest.chars()
        .next()
        .is_some_and(|c| c.is_alphabetic() || matches!(c, '°' | 'µ' | '℃' | '℉'))
}

/// `10km` -> (10, km). The number may be an expression (`2*5 km`); the unit is
/// the shortest tail that is a known one, found by trying each split.
fn split_value_unit(left: &str) -> Option<(f64, &'static Unit)> {
    for (i, _) in left.char_indices().skip(1) {
        let prefix = left[..i].trim_end();
        let rest = left[i..].trim();
        if prefix.is_empty() || !ends_a_number(prefix) || !starts_a_unit(rest) {
            continue;
        }
        let Some(unit) = find_unit(rest) else {
            continue;
        };
        if let Ok(value) = eval_value(prefix) {
            return Some((value, unit));
        }
    }
    None
}

/// Every way to cut `expr` into `(left, right)` at a connector, in reading order.
fn connector_splits(expr: &str) -> Vec<(&str, &str)> {
    let mut splits = Vec::new();
    for symbol in SYMBOL_CONNECTORS {
        if let Some((left, right)) = expr.split_once(symbol) {
            splits.push((left.trim(), right.trim()));
        }
    }
    let mut start = None;
    for (i, c) in expr
        .char_indices()
        .chain(std::iter::once((expr.len(), ' ')))
    {
        match (c.is_whitespace(), start) {
            (false, None) => start = Some(i),
            (true, Some(s)) => {
                if WORD_CONNECTORS.contains(&expr[s..i].to_lowercase().as_str()) {
                    splits.push((expr[..s].trim(), expr[i..].trim()));
                }
                start = None;
            }
            _ => {}
        }
    }
    splits
}

/// Round to `digits` significant figures, so `6.2137119223733` reads `6.213712`.
fn round_significant(v: f64, digits: i32) -> f64 {
    if v == 0.0 || !v.is_finite() {
        return v;
    }
    let scale = 10f64.powi(digits - 1 - v.abs().log10().floor() as i32);
    if !scale.is_finite() || scale == 0.0 {
        return v;
    }
    (v * scale).round() / scale
}

/// Answers `10km to mi`-shaped queries, or `None` to leave the query alone.
pub fn eval_conversion(query: &str) -> Option<Calculation> {
    let expr = query.trim();
    if expr.len() > MAX_LEN || !expr.chars().any(|c| c.is_ascii_digit()) {
        return None;
    }
    for (left, right) in connector_splits(expr) {
        let Some((amount, from)) = split_value_unit(left) else {
            continue;
        };
        let Some(to) = find_unit(right) else {
            continue;
        };
        if from.dim != to.dim {
            continue;
        }
        let base = amount * from.factor + from.offset;
        let value = round_significant((base - to.offset) / to.factor, SIGNIFICANT_DIGITS);
        if !value.is_finite() {
            return None;
        }
        return Some(Calculation {
            display: format!("{} {}", format_display(value), to.symbol),
            raw: format!("{} {}", format_raw(value), to.symbol),
            value,
        });
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shown(query: &str) -> Option<String> {
        eval_conversion(query).map(|c| c.display)
    }

    #[test]
    fn converts_within_a_dimension() {
        assert_eq!(shown("10km to mi").as_deref(), Some("6.213712 mi"));
        assert_eq!(shown("10 km to mi").as_deref(), Some("6.213712 mi"));
        assert_eq!(shown("70 kg in lb").as_deref(), Some("154.3236 lb"));
        assert_eq!(shown("2 hours to min").as_deref(), Some("120 min"));
        assert_eq!(shown("1 mph to km/h").as_deref(), Some("1.609344 km/h"));
        assert_eq!(shown("1 acre to m2").as_deref(), Some("4,046.856 m²"));
        assert_eq!(shown("1 gal to l").as_deref(), Some("3.785412 L"));
        assert_eq!(shown("1 cup to fl oz").as_deref(), Some("8 fl oz"));
    }

    #[test]
    fn temperatures_use_their_offsets() {
        assert_eq!(shown("100 f to c").as_deref(), Some("37.77778 °C"));
        assert_eq!(shown("0 c to k").as_deref(), Some("273.15 K"));
        assert_eq!(shown("212°F in °C").as_deref(), Some("100 °C"));
        assert_eq!(shown("-40 c to f").as_deref(), Some("-40 °F"));
        assert_eq!(shown("0 k to c").as_deref(), Some("-273.15 °C"));
    }

    #[test]
    fn data_sizes_tell_bytes_from_bits_by_case() {
        assert_eq!(shown("1 GB to MB").as_deref(), Some("1,000 MB"));
        assert_eq!(shown("1 gib to mb").as_deref(), Some("1,073.742 MB"));
        assert_eq!(shown("8 Mb to MB").as_deref(), Some("1 MB"));
        assert_eq!(shown("1 MB to Mb").as_deref(), Some("8 Mbit"));
        assert_eq!(shown("1 byte to bits").as_deref(), Some("8 bit"));
    }

    #[test]
    fn the_number_may_be_an_expression() {
        assert_eq!(shown("2*5 km to m").as_deref(), Some("10,000 m"));
        assert_eq!(shown("(1+1) hours to min").as_deref(), Some("120 min"));
        assert_eq!(shown("1,500 m to km").as_deref(), Some("1.5 km"));
    }

    #[test]
    fn every_connector_works() {
        for q in [
            "5 km to m",
            "5 km in m",
            "5 km as m",
            "5 km -> m",
            "5km->m",
            "5 km → m",
            "5 KM TO M",
        ] {
            assert_eq!(shown(q).as_deref(), Some("5,000 m"), "{q}");
        }
        assert_eq!(
            shown("5 km to m=?").as_deref(),
            None,
            "the caller strips `=?` first"
        );
    }

    #[test]
    fn inch_is_not_confused_with_the_word_in() {
        assert_eq!(shown("5 in to cm").as_deref(), Some("12.7 cm"));
        assert_eq!(shown("5 in in cm").as_deref(), Some("12.7 cm"));
        assert_eq!(shown("12 inches in ft").as_deref(), Some("1 ft"));
    }

    #[test]
    fn unlike_or_unknown_units_stay_silent() {
        for q in [
            "5 kg to m",     // mass is not length
            "5 km to flurb", // unknown unit
            "km to mi",      // no number
            "10 to 20",      // no units
            "20-05-2026",    // a date
            "1920x1080",     // a resolution
            "meeting at 10 in the morning",
            "5 km",    // nothing to convert to
            "5 km to", // half typed
            "",
        ] {
            assert_eq!(shown(q), None, "{q}");
        }
    }

    #[test]
    fn the_copied_text_keeps_the_unit() {
        let c = eval_conversion("10km to mi").unwrap();
        assert_eq!(c.raw, "6.213712 mi");
        assert!((c.value - 6.213712).abs() < 1e-9);
        let big = eval_conversion("1 pb to b").unwrap();
        assert_eq!(big.raw, "8e15 bit");
    }

    #[test]
    fn round_trips_stay_close() {
        for (a, b) in [
            ("km", "mi"),
            ("lb", "kg"),
            ("f", "c"),
            ("gal", "l"),
            ("ft", "in"),
        ] {
            let there = eval_conversion(&format!("123.456 {a} to {b}")).unwrap();
            let back = eval_conversion(&format!(
                "{} {b} to {a}",
                there.raw.split(' ').next().unwrap()
            ))
            .unwrap();
            assert!(
                (back.value - 123.456).abs() / 123.456 < 1e-4,
                "{a} <-> {b}: {}",
                back.value
            );
        }
    }
}

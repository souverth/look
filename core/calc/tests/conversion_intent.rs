//! Same guard rail as `intent.rs`, for unit conversion. The row it adds sits
//! above every search result, so a query that merely contains a number and the
//! word `in` or `to` must not trigger it.

use look_calc::eval_query;

/// Real things typed at a launcher that share words with a conversion.
#[test]
fn launcher_queries_that_are_not_conversions() {
    let queries = [
        "windows 11 in c",
        "top 10 in f1",
        "ubuntu 22 to 24",
        "python 3 in docker",
        "notes 2026 to 2027",
        "meeting at 10 in the morning",
        "chapter 5 to 7 summary",
        "vs code 2 to 3",
        "go to 5",
        "5 m to 5 km",
        "10 to 20",
        "2024-01-15 to 2024-02-15",
        "1.2.3 to 1.3.0",
        "192.168.1.1 to 192.168.1.9",
        "4k to 1080p",
        "mp3 to wav",
        "iphone 15 to 16",
    ];
    for q in queries {
        assert!(eval_query(q).is_none(), "{q} must not answer");
    }
}

/// What people do type, in the shapes they type it.
#[test]
fn conversions_people_type() {
    let cases = [
        ("10km to mi", "6.213712 mi"),
        ("10 km to mi", "6.213712 mi"),
        ("10 KM TO MI", "6.213712 mi"),
        ("5'", ""), // a foot mark alone is not a query this crate answers
        ("6 ft to cm", "182.88 cm"),
        ("180 lbs to kg", "81.64663 kg"),
        ("350 f to c", "176.6667 °C"),
        ("1 tb to gb", "1,000 GB"),
        ("90 min to h", "1.5 h"),
        ("60 mph to km/h", "96.56064 km/h"),
        ("2 l to cups", "8.453506 cup"),
    ];
    for (q, want) in cases {
        match (eval_query(q), want) {
            (None, "") => {}
            (Some(c), want) if !want.is_empty() => assert_eq!(c.display, want, "{q}"),
            (got, want) => panic!("{q}: got {got:?}, wanted {want:?}"),
        }
    }
}

/// Plain arithmetic is untouched by the conversion step.
#[test]
fn arithmetic_still_answers_as_before() {
    assert_eq!(eval_query("2+2").unwrap().display, "4");
    assert_eq!(eval_query("200*15%").unwrap().display, "30");
    assert!(eval_query("20-05-2026").is_none());
}

//! Prints what /agents would show on this machine, as JSON.
//!
//!   cargo run -p look-agents --example probe            # local data only
//!   cargo run -p look-agents --example probe -- --live  # also ask the vendors

use look_agents::{Options, status_all};

fn main() {
    let use_api = std::env::args().any(|a| a == "--live");
    let started = std::time::Instant::now();
    let statuses = status_all(Options {
        use_api,
        tz_offset_minutes: 0,
    });
    println!(
        "{}",
        serde_json::to_string_pretty(&statuses).expect("serializable")
    );
    eprintln!("took {:?}", started.elapsed());
}

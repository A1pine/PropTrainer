//! Prop Desk compute core.
//!
//! The browser and the SSR server both call this module through a tiny JSON
//! ABI. It owns the expensive O(n) batch work: scenario candle generation,
//! swing detection and plan simulation. Stateful O(1) work (broker ticks) and
//! rendering stay in TypeScript.
//!
//! Memory contract:
//!   1. JS allocates a request buffer with `prop_alloc`.
//!   2. JS copies UTF-8 JSON into it and calls a function.
//!   3. The function writes JSON into the global result buffer and returns 1.
//!   4. JS reads `prop_result_ptr` / `prop_result_len`, then frees the request.

#![allow(static_mut_refs)]

use serde::{Deserialize, Serialize};
use std::alloc::{alloc, dealloc, Layout};

mod analysis;
mod terminal;

// ---------------------------------------------------------------------------
// C ABI plumbing
// ---------------------------------------------------------------------------

static mut RESULT: Vec<u8> = Vec::new();

fn write_json<T: Serialize>(value: &T) {
    let bytes = serde_json::to_vec(value).unwrap_or_else(|_| b"{\"error\":\"serialize\"}".to_vec());
    write_bytes(bytes);
}

fn write_bytes(bytes: Vec<u8>) {
    unsafe {
        RESULT = bytes;
    }
}

fn write_error(message: &str) {
    write_json(&serde_json::json!({ "error": message }));
}

#[no_mangle]
pub extern "C" fn prop_alloc(size: usize) -> *mut u8 {
    if size == 0 {
        return std::ptr::null_mut();
    }
    unsafe {
        let layout = Layout::from_size_align_unchecked(size, 8);
        alloc(layout)
    }
}

#[no_mangle]
pub extern "C" fn prop_dealloc(ptr: *mut u8, size: usize) {
    if ptr.is_null() || size == 0 {
        return;
    }
    unsafe {
        let layout = Layout::from_size_align_unchecked(size, 8);
        dealloc(ptr, layout);
    }
}

#[no_mangle]
pub extern "C" fn prop_result_ptr() -> *const u8 {
    unsafe { RESULT.as_ptr() }
}

#[no_mangle]
pub extern "C" fn prop_result_len() -> usize {
    unsafe { RESULT.len() }
}

fn read_input(ptr: *const u8, len: usize) -> Option<Vec<u8>> {
    if ptr.is_null() || len == 0 {
        return None;
    }
    Some(unsafe { std::slice::from_raw_parts(ptr, len) }.to_vec())
}

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Candle {
    pub(crate) time: i64,
    pub(crate) open: f64,
    pub(crate) high: f64,
    pub(crate) low: f64,
    pub(crate) close: f64,
    pub(crate) volume: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Metrics {
    change_pct: f64,
    max_up_pct: f64,
    max_down_pct: f64,
    efficiency: f64,
    atr: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GenerateResponse {
    candles: Vec<Candle>,
    metrics: Metrics,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SwingPoint {
    pub(crate) index: usize,
    pub(crate) price: f64,
    pub(crate) kind: &'static str,
}

// ---------------------------------------------------------------------------
// PRNG (must mirror app/domain/shared/rng.ts)
// ---------------------------------------------------------------------------

struct Rng {
    state: u32,
}

impl Rng {
    fn from_seed(seed: &str) -> Self {
        let mut hash: u32 = 2_166_136_261;
        for byte in seed.as_bytes() {
            hash ^= *byte as u32;
            hash = hash.wrapping_mul(16_777_619);
        }
        Rng { state: hash }
    }

    fn next(&mut self) -> f64 {
        self.state = self.state.wrapping_add(0x6d2b_79f5);
        let mut value = self.state;
        value = (value ^ (value >> 15)).wrapping_mul(value | 1);
        value ^= value.wrapping_add((value ^ (value >> 7)).wrapping_mul(value | 61));
        ((value ^ (value >> 14)) as f64) / 4_294_967_296.0
    }

    fn range(&mut self, min: f64, max: f64) -> f64 {
        min + self.next() * (max - min)
    }

    fn int(&mut self, min: i64, max: i64) -> i64 {
        min + (self.next() * ((max - min + 1) as f64)).floor() as i64
    }

    fn gaussian(&mut self) -> f64 {
        let mut u = 0.0;
        let mut v = 0.0;
        while u == 0.0 {
            u = self.next();
        }
        while v == 0.0 {
            v = self.next();
        }
        let sample = (-2.0 * u.ln()).sqrt() * (2.0 * std::f64::consts::PI * v).cos();
        sample.clamp(-4.0, 4.0)
    }
}

// ---------------------------------------------------------------------------
// Numeric helpers (mirror app/domain/shared/math.ts)
// ---------------------------------------------------------------------------

fn decimals_for(tick: f64) -> u32 {
    let text = format!("{}", tick);
    if let Some(exponent) = text.find('e') {
        return text[exponent + 1..].trim_start_matches('-').parse::<u32>().unwrap_or(0);
    }
    match text.find('.') {
        Some(dot) => (text.len() - dot - 1) as u32,
        None => 0,
    }
}

pub(crate) fn round_to(value: f64, decimals: u32) -> f64 {
    let factor = 10f64.powi(decimals as i32);
    (value * factor).round() / factor
}

fn round_to_tick(price: f64, tick: f64) -> f64 {
    if tick <= 0.0 {
        return price;
    }
    let decimals = decimals_for(tick);
    round_to((price / tick).round() * tick, decimals)
}

// ---------------------------------------------------------------------------
// Scenario generation
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenerateRequest {
    seed: String,
    anchor_price: f64,
    volatility: f64,
    tick_size: f64,
    regime: String,
    bars: usize,
    start_price: f64,
    start_time: i64,
    timeframe_minutes: i64,
    replay_start: usize,
    base_volume: f64,
}

fn volume_for(base: f64, standardized_return: f64, rng: &mut Rng) -> f64 {
    let noise = 0.65 + rng.next() * 0.9;
    let activity = 1.0 + (standardized_return.abs() * 1.4).min(3.2);
    (base * noise * activity).round().max(1.0)
}

fn generate(req: &GenerateRequest) -> GenerateResponse {
    let sigma = req.anchor_price * 0.0009 * req.volatility;
    let volatility_multiplier = match req.regime.as_str() {
        "expansion" => 1.45,
        "range" => 0.85,
        _ => 1.0,
    };
    let tick = req.tick_size;
    let step = req.timeframe_minutes * 60;
    let mut rng = Rng::from_seed(&req.seed);

    let mut price = req.start_price;
    let mut center = req.start_price;
    let mut phase_left: i64 = 0;
    let mut phase_drift: f64 = 0.0;
    let mut phase_vol: f64 = volatility_multiplier;
    let mut impulse_direction: f64 = if req.regime == "downtrend" { -1.0 } else { 1.0 };
    let mut range_bars = rng.int(24, 52);
    let mut candles: Vec<Candle> = Vec::with_capacity(req.bars);

    for index in 0..req.bars {
        let mut drift: f64;
        let vol: f64;

        if req.regime == "uptrend" || req.regime == "downtrend" {
            if phase_left <= 0 {
                let roll = rng.next();
                if roll < 0.55 {
                    phase_left = rng.int(18, 40);
                    phase_drift = impulse_direction * sigma * rng.range(0.16, 0.26);
                    phase_vol = 1.05;
                } else if roll < 0.82 {
                    phase_left = rng.int(7, 16);
                    phase_drift = -impulse_direction * sigma * rng.range(0.1, 0.16);
                    phase_vol = 0.9;
                } else {
                    phase_left = rng.int(5, 12);
                    phase_drift = 0.0;
                    phase_vol = 0.72;
                }
            }
            phase_left -= 1;
            drift = phase_drift;
            vol = sigma * phase_vol * volatility_multiplier;
            center += impulse_direction * sigma * 0.02;
        } else if req.regime == "range" {
            range_bars -= 1;
            center += rng.gaussian() * sigma * 0.004;
            let deviation = price - center;
            let band = sigma * 6.0;
            drift = -deviation * 0.045;
            if deviation.abs() > band {
                drift = -deviation.signum() * sigma * 0.1;
            }
            if range_bars <= 0 && rng.next() < 0.05 {
                let direction = if deviation == 0.0 { 1.0 } else { deviation.signum() };
                drift = direction * sigma * 0.28;
                range_bars = rng.int(24, 52);
            }
            vol = sigma * 0.8;
        } else {
            if rng.next() < 0.12 {
                impulse_direction = -impulse_direction;
            }
            drift = impulse_direction * sigma * 0.035;
            vol = sigma * 1.45;
        }

        let open = price;
        let gap = if rng.next() < 0.012 {
            rng.gaussian() * sigma * 0.45
        } else {
            0.0
        };
        let open_with_gap = open + gap;
        let ret = drift + rng.gaussian() * vol;
        let close = open_with_gap + ret;
        let wick_up = rng.gaussian().abs() * vol * rng.range(0.25, 0.7);
        let wick_down = rng.gaussian().abs() * vol * rng.range(0.25, 0.7);
        let high = open_with_gap.max(close) + wick_up;
        let low = open_with_gap.min(close) - wick_down;

        let mut bar = Candle {
            time: req.start_time + index as i64 * step,
            open: round_to_tick(open_with_gap, tick),
            high: round_to_tick(high, tick),
            low: round_to_tick(low, tick),
            close: round_to_tick(close, tick),
            volume: volume_for(req.base_volume, ret / sigma, &mut rng),
        };
        if bar.high <= bar.open.max(bar.close) {
            bar.high = bar.open.max(bar.close) + tick;
        }
        if bar.low >= bar.open.min(bar.close) {
            bar.low = bar.open.min(bar.close) - tick;
        }
        if bar.low <= 0.0 {
            bar.low = tick;
        }

        candles.push(bar);
        price = bar.close;
    }

    let metrics = compute_metrics(&candles, req.replay_start, req.anchor_price);
    GenerateResponse { candles, metrics }
}

fn compute_metrics(candles: &[Candle], replay_start: usize, _anchor: f64) -> Metrics {
    if candles.is_empty() || replay_start >= candles.len() {
        return Metrics {
            change_pct: 0.0,
            max_up_pct: 0.0,
            max_down_pct: 0.0,
            efficiency: 0.0,
            atr: 0.0,
        };
    }
    let start_price = candles[replay_start].open;
    let window = &candles[replay_start..];
    let highs = window.iter().map(|c| c.high).fold(f64::MIN, f64::max);
    let lows = window.iter().map(|c| c.low).fold(f64::MAX, f64::min);
    let last = window.last().map(|c| c.close).unwrap_or(start_price);
    let net = (last - start_price).abs();
    let mut path = 0.0;
    for (offset, candle) in window.iter().enumerate() {
        let previous = if offset == 0 {
            start_price
        } else {
            window[offset - 1].close
        };
        path += (candle.close - previous).abs();
    }
    let efficiency = if path == 0.0 { 0.0 } else { round_to(net / path, 3) };
    let change = if start_price == 0.0 {
        0.0
    } else {
        (last - start_price) / start_price * 100.0
    };
    let max_up = if start_price == 0.0 {
        0.0
    } else {
        (highs - start_price) / start_price * 100.0
    };
    let max_down = if start_price == 0.0 {
        0.0
    } else {
        (lows - start_price) / start_price * 100.0
    };

    let atr_start = if replay_start > 14 { replay_start - 14 } else { 0 };
    let mut total = 0.0;
    let mut count = 0usize;
    for index in atr_start.max(1)..replay_start {
        let candle = &candles[index];
        let previous = &candles[index - 1];
        let true_range = (candle.high - candle.low)
            .max((candle.high - previous.close).abs())
            .max((candle.low - previous.close).abs());
        total += true_range;
        count += 1;
    }
    let atr = if count > 0 { total / count as f64 } else { 0.0 };

    Metrics {
        change_pct: round_to(change, 3),
        max_up_pct: round_to(max_up, 3),
        max_down_pct: round_to(max_down, 3),
        efficiency,
        atr: round_to(atr, 2),
    }
}

#[no_mangle]
pub extern "C" fn prop_generate(ptr: *const u8, len: usize) -> u32 {
    let Some(bytes) = read_input(ptr, len) else {
        write_error("empty input");
        return 0;
    };
    let req: GenerateRequest = match serde_json::from_slice(&bytes) {
        Ok(value) => value,
        Err(error) => {
            write_error(&error.to_string());
            return 0;
        }
    };
    if req.bars == 0 || req.tick_size <= 0.0 {
        write_error("invalid generation request");
        return 0;
    }
    let response = generate(&req);
    write_json(&response);
    1
}

// ---------------------------------------------------------------------------
// Swing detection
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FindSwingsRequest {
    candles: Vec<Candle>,
    strength: usize,
}

#[derive(Serialize)]
struct FindSwingsResponse {
    swings: Vec<SwingPoint>,
}

pub(crate) fn find_swings(candles: &[Candle], strength: usize) -> Vec<SwingPoint> {
    let mut swings = Vec::new();
    if strength == 0 || candles.len() <= strength * 2 {
        return swings;
    }
    for index in strength..candles.len() - strength {
        let candle = &candles[index];
        let mut is_high = true;
        let mut is_low = true;
        for offset in 1..=strength {
            let left = &candles[index - offset];
            let right = &candles[index + offset];
            if candle.high <= left.high || candle.high <= right.high {
                is_high = false;
            }
            if candle.low >= left.low || candle.low >= right.low {
                is_low = false;
            }
        }
        if is_high {
            swings.push(SwingPoint {
                index,
                price: candle.high,
                kind: "high",
            });
        }
        if is_low {
            swings.push(SwingPoint {
                index,
                price: candle.low,
                kind: "low",
            });
        }
    }
    swings
}

#[no_mangle]
pub extern "C" fn prop_find_swings(ptr: *const u8, len: usize) -> u32 {
    let Some(bytes) = read_input(ptr, len) else {
        write_error("empty input");
        return 0;
    };
    let req: FindSwingsRequest = match serde_json::from_slice(&bytes) {
        Ok(value) => value,
        Err(error) => {
            write_error(&error.to_string());
            return 0;
        }
    };
    let swings = find_swings(&req.candles, req.strength.max(1));
    write_json(&FindSwingsResponse { swings });
    1
}

// ---------------------------------------------------------------------------
// Plan simulation
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlanRequest {
    plan: Plan,
    candles: Vec<Candle>,
    instrument: Instrument,
    horizon_bars: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Plan {
    direction: String,
    entry: Option<f64>,
    stop: Option<f64>,
    target: Option<f64>,
    submitted_at_bar: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Instrument {
    tick_size: f64,
    point_value: f64,
    fee_per_contract: f64,
    tick_value: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PlanOutcome {
    filled: bool,
    entry_bar: Option<usize>,
    entry_price: Option<f64>,
    exit_bar: Option<usize>,
    exit_price: Option<f64>,
    exit_reason: &'static str,
    r_multiple: Option<f64>,
    mae_r: Option<f64>,
    mfe_r: Option<f64>,
    bars_to_entry: usize,
    bars_held: usize,
}

fn empty_outcome() -> PlanOutcome {
    PlanOutcome {
        filled: false,
        entry_bar: None,
        entry_price: None,
        exit_bar: None,
        exit_price: None,
        exit_reason: "no-entry",
        r_multiple: None,
        mae_r: None,
        mfe_r: None,
        bars_to_entry: 0,
        bars_held: 0,
    }
}

fn inspect_bar(
    candle: &Candle,
    entry: f64,
    stop: f64,
    target: f64,
    is_long: bool,
    point_value: f64,
    mae: &mut f64,
    mfe: &mut f64,
) -> Option<(f64, &'static str)> {
    let (adverse, favorable) = if is_long {
        (
            (entry - candle.low) * point_value,
            (candle.high - entry) * point_value,
        )
    } else {
        (
            (candle.high - entry) * point_value,
            (entry - candle.low) * point_value,
        )
    };
    *mae = mae.max(adverse);
    *mfe = mfe.max(favorable);

    if is_long {
        if candle.open <= stop {
            return Some((candle.open, "stop"));
        }
        if candle.open >= target {
            return Some((candle.open, "target"));
        }
        if candle.low <= stop {
            return Some((stop, "stop"));
        }
        if candle.high >= target {
            return Some((target, "target"));
        }
    } else {
        if candle.open >= stop {
            return Some((candle.open, "stop"));
        }
        if candle.open <= target {
            return Some((candle.open, "target"));
        }
        if candle.high >= stop {
            return Some((stop, "stop"));
        }
        if candle.low <= target {
            return Some((target, "target"));
        }
    }
    None
}

#[allow(clippy::too_many_arguments)]
fn finish(
    exit_price: f64,
    reason: &'static str,
    entry_price: f64,
    entry_bar: usize,
    exit_bar: usize,
    is_long: bool,
    point_value: f64,
    fee: f64,
    risk_per_contract: f64,
    mae: f64,
    mfe: f64,
    submitted_at_bar: usize,
) -> PlanOutcome {
    let gross = (exit_price - entry_price) * if is_long { 1.0 } else { -1.0 } * point_value;
    let r_multiple = if risk_per_contract > 0.0 {
        Some(round_to((gross - fee) / risk_per_contract, 2))
    } else {
        None
    };
    PlanOutcome {
        filled: true,
        entry_bar: Some(entry_bar),
        entry_price: Some(entry_price),
        exit_bar: Some(exit_bar),
        exit_price: Some(exit_price),
        exit_reason: reason,
        r_multiple,
        mae_r: if risk_per_contract > 0.0 {
            Some(round_to(-mae / risk_per_contract, 2))
        } else {
            None
        },
        mfe_r: if risk_per_contract > 0.0 {
            Some(round_to(mfe / risk_per_contract, 2))
        } else {
            None
        },
        bars_to_entry: entry_bar.saturating_sub(submitted_at_bar),
        bars_held: exit_bar - entry_bar + 1,
    }
}

fn simulate(req: &PlanRequest) -> PlanOutcome {
    let direction = req.plan.direction.as_str();
    let (Some(entry_level), Some(stop_level), Some(target_level)) =
        (req.plan.entry, req.plan.stop, req.plan.target)
    else {
        return empty_outcome();
    };
    if direction != "long" && direction != "short" {
        return empty_outcome();
    }
    let is_long = direction == "long";
    let start = req.plan.submitted_at_bar.saturating_add(1);
    if start >= req.candles.len() {
        return empty_outcome();
    }
    let end = req
        .candles
        .len()
        .min(start.saturating_add(req.horizon_bars.max(1)));
    let risk_per_contract = (entry_level - stop_level).abs() / req.instrument.tick_size
        * req.instrument.tick_value
        + req.instrument.fee_per_contract;

    for index in start..end {
        let bar = &req.candles[index];
        let triggered = if is_long {
            bar.low <= entry_level
        } else {
            bar.high >= entry_level
        };
        if !triggered {
            continue;
        }
        let entry_price = if is_long {
            entry_level.min(bar.open)
        } else {
            entry_level.max(bar.open)
        };
        let mut mae = 0.0f64;
        let mut mfe = 0.0f64;

        if let Some((price, reason)) = inspect_bar(
            bar,
            entry_price,
            stop_level,
            target_level,
            is_long,
            req.instrument.point_value,
            &mut mae,
            &mut mfe,
        ) {
            return finish(
                price,
                reason,
                entry_price,
                index,
                index,
                is_long,
                req.instrument.point_value,
                req.instrument.fee_per_contract,
                risk_per_contract,
                mae,
                mfe,
                req.plan.submitted_at_bar,
            );
        }

        for cursor in index + 1..end {
            let candle = &req.candles[cursor];
            if let Some((price, reason)) = inspect_bar(
                candle,
                entry_price,
                stop_level,
                target_level,
                is_long,
                req.instrument.point_value,
                &mut mae,
                &mut mfe,
            ) {
                return finish(
                    price,
                    reason,
                    entry_price,
                    index,
                    cursor,
                    is_long,
                    req.instrument.point_value,
                    req.instrument.fee_per_contract,
                    risk_per_contract,
                    mae,
                    mfe,
                    req.plan.submitted_at_bar,
                );
            }
        }

        let last_index = end - 1;
        let last_close = req.candles.get(last_index).map(|c| c.close).unwrap_or(entry_level);
        return finish(
            last_close,
            "timeout",
            entry_price,
            index,
            last_index,
            is_long,
            req.instrument.point_value,
            req.instrument.fee_per_contract,
            risk_per_contract,
            mae,
            mfe,
            req.plan.submitted_at_bar,
        );
    }

    empty_outcome()
}

#[no_mangle]
pub extern "C" fn prop_simulate_plan(ptr: *const u8, len: usize) -> u32 {
    let Some(bytes) = read_input(ptr, len) else {
        write_error("empty input");
        return 0;
    };
    let req: PlanRequest = match serde_json::from_slice(&bytes) {
        Ok(value) => value,
        Err(error) => {
            write_error(&error.to_string());
            return 0;
        }
    };
    if req.instrument.tick_size <= 0.0 {
        write_error("invalid tick size");
        return 0;
    }
    let outcome = simulate(&req);
    write_json(&outcome);
    1
}

#[no_mangle]
pub extern "C" fn prop_analyze(ptr: *const u8, len: usize) -> u32 {
    let Some(bytes) = read_input(ptr, len) else {
        write_error("empty input");
        return 0;
    };
    match analysis::analyze_json(&bytes) {
        Ok(output) => {
            write_bytes(output);
            1
        }
        Err(error) => {
            write_error(&error);
            0
        }
    }
}

#[no_mangle]
pub extern "C" fn prop_aggregate(ptr: *const u8, len: usize) -> u32 {
    let Some(bytes) = read_input(ptr, len) else {
        write_error("empty input");
        return 0;
    };
    match terminal::aggregate_json(&bytes) {
        Ok(output) => {
            write_bytes(output);
            1
        }
        Err(error) => {
            write_error(&error);
            0
        }
    }
}

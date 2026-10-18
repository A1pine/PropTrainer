//! Chart analysis: indicators, price action, ICT concepts and order-flow
//! proxies. Everything is computed from OHLCV; there is no bid/ask feed, so
//! flow metrics are explicitly proxies and labelled as such in the UI.

use crate::{find_swings, round_to, Candle, SwingPoint};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AnalyzeRequest {
    candles: Vec<Candle>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Report {
    bias: Bias,
    trend: Trend,
    pa: PriceAction,
    ict: Ict,
    flow: Flow,
    indicators: Indicators,
    events: Vec<Event>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Bias {
    direction: &'static str,
    score: f64,
    confidence: f64,
    reasons: Vec<Reason>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Reason {
    code: &'static str,
    points: f64,
    value: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Trend {
    direction: &'static str,
    structure: &'static str,
    ema_alignment: &'static str,
    adx: Option<f64>,
    premium_discount: f64,
    range_high: f64,
    range_low: f64,
    swings: Vec<SwingOut>,
    breaks: Vec<Break>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SwingOut {
    index: usize,
    price: f64,
    kind: &'static str,
    label: &'static str,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Break {
    index: usize,
    price: f64,
    kind: &'static str,
    direction: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PriceAction {
    patterns: Vec<Pattern>,
    levels: Vec<Level>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Pattern {
    index: usize,
    kind: &'static str,
    direction: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Level {
    price: f64,
    kind: &'static str,
    touches: usize,
    last_index: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Ict {
    fvgs: Vec<Fvg>,
    order_blocks: Vec<OrderBlock>,
    liquidity: Vec<Liquidity>,
    sweeps: Vec<Sweep>,
    premium_discount: f64,
    zone: &'static str,
    session: &'static str,
    killzone: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Fvg {
    from: usize,
    to: usize,
    top: f64,
    bottom: f64,
    direction: &'static str,
    filled: f64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct OrderBlock {
    index: usize,
    top: f64,
    bottom: f64,
    direction: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Liquidity {
    price: f64,
    kind: &'static str,
    touches: usize,
    index: usize,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Sweep {
    index: usize,
    price: f64,
    direction: &'static str,
    kind: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Flow {
    pressure: f64,
    delta: Vec<Option<f64>>,
    profile: Vec<ProfileBar>,
    poc: f64,
    vah: f64,
    val: f64,
    absorptions: Vec<Absorption>,
    divergence: &'static str,
    imbalance: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProfileBar {
    price: f64,
    volume: f64,
    in_value_area: bool,
    is_poc: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Absorption {
    index: usize,
    price: f64,
    direction: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Indicators {
    ema20: Vec<Option<f64>>,
    ema50: Vec<Option<f64>>,
    ema200: Vec<Option<f64>>,
    vwap: Vec<Option<f64>>,
    bb_upper: Vec<Option<f64>>,
    bb_lower: Vec<Option<f64>>,
    rsi: Vec<Option<f64>>,
    macd: Vec<Option<f64>>,
    macd_signal: Vec<Option<f64>>,
    macd_hist: Vec<Option<f64>>,
    atr: Vec<Option<f64>>,
    adx: Vec<Option<f64>>,
    latest: Latest,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Latest {
    price: f64,
    ema20: Option<f64>,
    ema50: Option<f64>,
    ema200: Option<f64>,
    vwap: Option<f64>,
    bb_upper: Option<f64>,
    bb_lower: Option<f64>,
    rsi: Option<f64>,
    macd: Option<f64>,
    macd_signal: Option<f64>,
    macd_hist: Option<f64>,
    atr: Option<f64>,
    adx: Option<f64>,
    volume_sma: Option<f64>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Event {
    index: usize,
    time: i64,
    kind: &'static str,
    direction: &'static str,
    price: f64,
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

pub fn analyze_json(input: &[u8]) -> Result<Vec<u8>, String> {
    let request: AnalyzeRequest = serde_json::from_slice(input).map_err(|error| error.to_string())?;
    if request.candles.len() < 30 {
        return Err("at least 30 candles are required for analysis".into());
    }
    let report = analyze(&request.candles);
    serde_json::to_vec(&report).map_err(|error| error.to_string())
}

fn analyze(candles: &[Candle]) -> Report {
    let n = candles.len();
    let closes: Vec<f64> = candles.iter().map(|c| c.close).collect();
    let ema20 = ema_series(&closes, 20);
    let ema50 = ema_series(&closes, 50);
    let ema200 = ema_series(&closes, 200);
    let vwap = vwap_series(candles);
    let (_bb_mid, bb_upper, bb_lower) = bollinger(&closes, 20, 2.0);
    let rsi = rsi_series(&closes, 14);
    let (macd, macd_signal, macd_hist) = macd_series(&closes);
    let atr = atr_series(candles, 14);
    let adx = adx_series(candles, 14);
    let volume_sma = sma_values(&candles.iter().map(|c| c.volume).collect::<Vec<_>>(), 20);
    let atr_last = last_value(&atr).unwrap_or_else(|| average_true_range(candles, 14));

    let swings = find_swings(candles, 3);
    let (breaks, structure_trend) = structure_breaks(candles, &swings);
    let swing_labels = label_swings(&swings, 10);
    let (range_high, range_low) = recent_range(candles, 100);
    let premium_discount = if range_high > range_low {
        ((candles[n - 1].close - range_low) / (range_high - range_low)).clamp(0.0, 1.0)
    } else {
        0.5
    };
    let zone = if premium_discount > 0.65 {
        "premium"
    } else if premium_discount < 0.35 {
        "discount"
    } else {
        "equilibrium"
    };

    let ema_alignment = alignment(last_value(&ema20), last_value(&ema50), last_value(&ema200));
    let trend_direction = if structure_trend > 0 && ema_alignment != "bearish" {
        "bullish"
    } else if structure_trend < 0 && ema_alignment != "bullish" {
        "bearish"
    } else if ema_alignment == "bullish" {
        "bullish"
    } else if ema_alignment == "bearish" {
        "bearish"
    } else {
        "neutral"
    };
    let structure = match (structure_trend, swings.len()) {
        (1, _) => "hh_hl",
        (-1, _) => "lh_ll",
        _ => "mixed",
    };

    let patterns = patterns(candles);
    let levels = cluster_levels(&swings, atr_last * 0.25, candles[n - 1].close, 6);
    let fvgs = fair_value_gaps(candles);
    let order_blocks = order_blocks(candles, &breaks);
    let liquidity = liquidity_levels(&swings, atr_last, n);
    let sweeps = liquidity_sweeps(candles, &swings, 10);
    let session = session_label(candles[n - 1].time);
    let killzone = matches!(session, "london" | "newYork");

    let delta = delta_series(candles);
    let cumulative = cumulative_delta(&delta);
    let pressure = pressure(&delta, &candles, 20);
    let (profile, poc, vah, val) = volume_profile(candles, 24);
    let absorptions = absorptions(candles, &atr, &volume_sma);
    let divergence = divergence(&candles, &swings, &cumulative);
    let imbalance = imbalance(&delta, &candles, 20);

    let latest = Latest {
        price: candles[n - 1].close,
        ema20: last_value(&ema20),
        ema50: last_value(&ema50),
        ema200: last_value(&ema200),
        vwap: last_value(&vwap),
        bb_upper: last_value(&bb_upper),
        bb_lower: last_value(&bb_lower),
        rsi: last_value(&rsi),
        macd: last_value(&macd),
        macd_signal: last_value(&macd_signal),
        macd_hist: last_value(&macd_hist),
        atr: last_value(&atr),
        adx: last_value(&adx),
        volume_sma: last_value(&volume_sma),
    };

    let bias = build_bias(
        trend_direction,
        structure,
        ema_alignment,
        premium_discount,
        &sweeps,
        pressure,
        latest.rsi,
        latest.macd_hist,
        divergence,
    );

    let mut events: Vec<Event> = Vec::new();
    for item in &breaks {
        events.push(Event {
            index: item.index,
            time: candles[item.index].time,
            kind: item.kind,
            direction: item.direction,
            price: round_to(item.price, 4),
        });
    }
    for item in &sweeps {
        events.push(Event {
            index: item.index,
            time: candles[item.index].time,
            kind: "sweep",
            direction: item.direction,
            price: round_to(item.price, 4),
        });
    }
    for item in &fvgs {
        events.push(Event {
            index: item.to,
            time: candles[item.to].time,
            kind: "fvg",
            direction: item.direction,
            price: round_to((item.top + item.bottom) / 2.0, 4),
        });
    }
    for item in &patterns {
        events.push(Event {
            index: item.index,
            time: candles[item.index].time,
            kind: item.kind,
            direction: item.direction,
            price: round_to(candles[item.index].close, 4),
        });
    }
    for item in &absorptions {
        events.push(Event {
            index: item.index,
            time: candles[item.index].time,
            kind: "absorption",
            direction: item.direction,
            price: round_to(item.price, 4),
        });
    }
    if divergence != "none" {
        events.push(Event {
            index: n - 1,
            time: candles[n - 1].time,
            kind: "divergence",
            direction: divergence,
            price: round_to(candles[n - 1].close, 4),
        });
    }
    events.sort_by(|a, b| b.index.cmp(&a.index));
    events.truncate(24);

    Report {
        bias,
        trend: Trend {
            direction: trend_direction,
            structure,
            ema_alignment,
            adx: latest.adx,
            premium_discount: round_to(premium_discount * 100.0, 1),
            range_high: round_to(range_high, 4),
            range_low: round_to(range_low, 4),
            swings: swing_labels,
            breaks: breaks.iter().rev().take(6).cloned().collect(),
        },
        pa: PriceAction { patterns, levels },
        ict: Ict {
            fvgs,
            order_blocks,
            liquidity,
            sweeps,
            premium_discount: round_to(premium_discount * 100.0, 1),
            zone,
            session,
            killzone,
        },
        flow: Flow {
            pressure: round_to(pressure, 3),
            delta: cumulative,
            profile,
            poc: round_to(poc, 4),
            vah: round_to(vah, 4),
            val: round_to(val, 4),
            absorptions,
            divergence,
            imbalance: round_to(imbalance, 3),
        },
        indicators: Indicators {
            ema20: rounded_series(&ema20),
            ema50: rounded_series(&ema50),
            ema200: rounded_series(&ema200),
            vwap: rounded_series(&vwap),
            bb_upper: rounded_series(&bb_upper),
            bb_lower: rounded_series(&bb_lower),
            rsi: rounded_series(&rsi),
            macd: rounded_series(&macd),
            macd_signal: rounded_series(&macd_signal),
            macd_hist: rounded_series(&macd_hist),
            atr: rounded_series(&atr),
            adx: rounded_series(&adx),
            latest,
        },
        events,
    }
}

// ---------------------------------------------------------------------------
// Indicators
// ---------------------------------------------------------------------------

fn sma_values(values: &[f64], period: usize) -> Vec<Option<f64>> {
    let mut out = vec![None; values.len()];
    if period == 0 || values.len() < period {
        return out;
    }
    let mut sum: f64 = values[..period].iter().sum();
    out[period - 1] = Some(sum / period as f64);
    for index in period..values.len() {
        sum += values[index] - values[index - period];
        out[index] = Some(sum / period as f64);
    }
    out
}

fn ema_series(values: &[f64], period: usize) -> Vec<Option<f64>> {
    let mut out = vec![None; values.len()];
    if period == 0 || values.len() < period {
        return out;
    }
    let k = 2.0 / (period as f64 + 1.0);
    let seed: f64 = values[..period].iter().sum::<f64>() / period as f64;
    out[period - 1] = Some(seed);
    let mut previous = seed;
    for index in period..values.len() {
        previous = values[index] * k + previous * (1.0 - k);
        out[index] = Some(previous);
    }
    out
}

fn ema_compact(values: &[f64], period: usize) -> Vec<f64> {
    if values.len() < period {
        return vec![];
    }
    let k = 2.0 / (period as f64 + 1.0);
    let mut previous = values[..period].iter().sum::<f64>() / period as f64;
    let mut out = vec![previous];
    for value in values.iter().skip(period) {
        previous = value * k + previous * (1.0 - k);
        out.push(previous);
    }
    out
}

fn rsi_series(values: &[f64], period: usize) -> Vec<Option<f64>> {
    let mut out = vec![None; values.len()];
    if values.len() <= period {
        return out;
    }
    let mut gains = 0.0;
    let mut losses = 0.0;
    for index in 1..=period {
        let change = values[index] - values[index - 1];
        if change >= 0.0 {
            gains += change;
        } else {
            losses -= change;
        }
    }
    let mut avg_gain = gains / period as f64;
    let mut avg_loss = losses / period as f64;
    out[period] = Some(rsi_value(avg_gain, avg_loss));
    for index in period + 1..values.len() {
        let change = values[index] - values[index - 1];
        let gain = if change > 0.0 { change } else { 0.0 };
        let loss = if change < 0.0 { -change } else { 0.0 };
        avg_gain = (avg_gain * (period as f64 - 1.0) + gain) / period as f64;
        avg_loss = (avg_loss * (period as f64 - 1.0) + loss) / period as f64;
        out[index] = Some(rsi_value(avg_gain, avg_loss));
    }
    out
}

fn rsi_value(avg_gain: f64, avg_loss: f64) -> f64 {
    if avg_loss == 0.0 {
        return 100.0;
    }
    100.0 - 100.0 / (1.0 + avg_gain / avg_loss)
}

fn true_ranges(candles: &[Candle]) -> Vec<f64> {
    let mut out = vec![0.0; candles.len()];
    for index in 0..candles.len() {
        if index == 0 {
            out[index] = candles[index].high - candles[index].low;
        } else {
            let previous = candles[index - 1].close;
            out[index] = (candles[index].high - candles[index].low)
                .max((candles[index].high - previous).abs())
                .max((candles[index].low - previous).abs());
        }
    }
    out
}

fn atr_series(candles: &[Candle], period: usize) -> Vec<Option<f64>> {
    let tr = true_ranges(candles);
    let mut out = vec![None; candles.len()];
    if candles.len() <= period {
        return out;
    }
    let mut value: f64 = tr[1..=period].iter().sum::<f64>() / period as f64;
    out[period] = Some(value);
    for index in period + 1..candles.len() {
        value = (value * (period as f64 - 1.0) + tr[index]) / period as f64;
        out[index] = Some(value);
    }
    out
}

fn average_true_range(candles: &[Candle], period: usize) -> f64 {
    let tr = true_ranges(candles);
    let start = candles.len().saturating_sub(period);
    if start >= tr.len() {
        return 1.0;
    }
    let window = &tr[start..];
    if window.is_empty() {
        return 1.0;
    }
    window.iter().sum::<f64>() / window.len() as f64
}

fn adx_series(candles: &[Candle], period: usize) -> Vec<Option<f64>> {
    let n = candles.len();
    let mut out = vec![None; n];
    if n <= period * 2 + 1 {
        return out;
    }
    let tr = true_ranges(candles);
    let mut plus_dm = vec![0.0; n];
    let mut minus_dm = vec![0.0; n];
    for index in 1..n {
        let up = candles[index].high - candles[index - 1].high;
        let down = candles[index - 1].low - candles[index].low;
        plus_dm[index] = if up > down && up > 0.0 { up } else { 0.0 };
        minus_dm[index] = if down > up && down > 0.0 { down } else { 0.0 };
    }
    let mut tr_sum: f64 = tr[1..=period].iter().sum();
    let mut plus_sum: f64 = plus_dm[1..=period].iter().sum();
    let mut minus_sum: f64 = minus_dm[1..=period].iter().sum();
    let mut dx_values: Vec<f64> = Vec::new();

    for index in period + 1..n {
        tr_sum = tr_sum - tr_sum / period as f64 + tr[index];
        plus_sum = plus_sum - plus_sum / period as f64 + plus_dm[index];
        minus_sum = minus_sum - minus_sum / period as f64 + minus_dm[index];
        let plus_di = if tr_sum > 0.0 { 100.0 * plus_sum / tr_sum } else { 0.0 };
        let minus_di = if tr_sum > 0.0 { 100.0 * minus_sum / tr_sum } else { 0.0 };
        let sum = plus_di + minus_di;
        let dx = if sum > 0.0 { 100.0 * (plus_di - minus_di).abs() / sum } else { 0.0 };
        dx_values.push(dx);
        if dx_values.len() >= period {
            let start = dx_values.len() - period;
            let adx = dx_values[start..].iter().sum::<f64>() / period as f64;
            out[index] = Some(adx);
        }
    }
    out
}

fn bollinger(values: &[f64], period: usize, mult: f64) -> (Vec<Option<f64>>, Vec<Option<f64>>, Vec<Option<f64>>) {
    let mid = sma_values(values, period);
    let mut upper = vec![None; values.len()];
    let mut lower = vec![None; values.len()];
    for index in period.saturating_sub(1)..values.len() {
        if let Some(mean) = mid[index] {
            let window = &values[index + 1 - period..=index];
            let variance = window.iter().map(|value| (value - mean).powi(2)).sum::<f64>() / period as f64;
            let deviation = variance.sqrt();
            upper[index] = Some(mean + deviation * mult);
            lower[index] = Some(mean - deviation * mult);
        }
    }
    (mid, upper, lower)
}

fn macd_series(values: &[f64]) -> (Vec<Option<f64>>, Vec<Option<f64>>, Vec<Option<f64>>) {
    let fast = ema_series(values, 12);
    let slow = ema_series(values, 26);
    let mut macd = vec![None; values.len()];
    let mut compact = Vec::new();
    let mut indices = Vec::new();
    for index in 0..values.len() {
        if let (Some(a), Some(b)) = (fast[index], slow[index]) {
            macd[index] = Some(a - b);
            compact.push(a - b);
            indices.push(index);
        }
    }
    let signal_compact = ema_compact(&compact, 9);
    let mut signal = vec![None; values.len()];
    let mut hist = vec![None; values.len()];
    if !signal_compact.is_empty() {
        let offset = indices.len() - signal_compact.len();
        for (position, value) in signal_compact.iter().enumerate() {
            let index = indices[offset + position];
            signal[index] = Some(*value);
            if let Some(line) = macd[index] {
                hist[index] = Some(line - value);
            }
        }
    }
    (macd, signal, hist)
}

fn vwap_series(candles: &[Candle]) -> Vec<Option<f64>> {
    let mut out = Vec::with_capacity(candles.len());
    let mut volume = 0.0;
    let mut total = 0.0;
    for candle in candles {
        let typical = (candle.high + candle.low + candle.close) / 3.0;
        volume += candle.volume;
        total += typical * candle.volume;
        out.push(if volume > 0.0 { Some(total / volume) } else { None });
    }
    out
}

fn alignment(fast: Option<f64>, mid: Option<f64>, slow: Option<f64>) -> &'static str {
    match (fast, mid, slow) {
        (Some(fast), Some(mid), Some(slow)) if fast > mid && mid > slow => "bullish",
        (Some(fast), Some(mid), Some(slow)) if fast < mid && mid < slow => "bearish",
        _ => "flat",
    }
}

fn last_value(series: &[Option<f64>]) -> Option<f64> {
    series.iter().rev().find_map(|value| *value)
}

fn rounded_series(series: &[Option<f64>]) -> Vec<Option<f64>> {
    series.iter().map(|value| value.map(|inner| round_to(inner, 4))).collect()
}

// ---------------------------------------------------------------------------
// Structure, price action, ICT
// ---------------------------------------------------------------------------

fn structure_breaks(candles: &[Candle], swings: &[SwingPoint]) -> (Vec<Break>, i32) {
    let mut breaks = Vec::new();
    let mut trend = 0i32;
    let mut high_ref: Option<SwingPoint> = None;
    let mut low_ref: Option<SwingPoint> = None;
    let mut cursor = 0usize;
    for index in 0..candles.len() {
        while cursor < swings.len() && swings[cursor].index + 3 <= index {
            let swing = swings[cursor].clone();
            if swing.kind == "high" {
                high_ref = Some(swing);
            } else {
                low_ref = Some(swing);
            }
            cursor += 1;
        }
        let close = candles[index].close;
        if let Some(reference) = &high_ref {
            if close > reference.price {
                breaks.push(Break {
                    index,
                    price: reference.price,
                    kind: if trend < 0 { "choch" } else { "bos" },
                    direction: "bullish",
                });
                trend = 1;
                high_ref = None;
            }
        }
        if let Some(reference) = &low_ref {
            if close < reference.price {
                breaks.push(Break {
                    index,
                    price: reference.price,
                    kind: if trend > 0 { "choch" } else { "bos" },
                    direction: "bearish",
                });
                trend = -1;
                low_ref = None;
            }
        }
    }
    (breaks, trend)
}

fn label_swings(swings: &[SwingPoint], limit: usize) -> Vec<SwingOut> {
    let mut previous_high: Option<f64> = None;
    let mut previous_low: Option<f64> = None;
    let mut labeled: Vec<SwingOut> = Vec::new();
    for swing in swings {
        let label = if swing.kind == "high" {
            let label = match previous_high {
                Some(price) if swing.price > price => "HH",
                Some(_) => "LH",
                None => "H",
            };
            previous_high = Some(swing.price);
            label
        } else {
            let label = match previous_low {
                Some(price) if swing.price < price => "LL",
                Some(_) => "HL",
                None => "L",
            };
            previous_low = Some(swing.price);
            label
        };
        labeled.push(SwingOut {
            index: swing.index,
            price: round_to(swing.price, 4),
            kind: swing.kind,
            label,
        });
    }
    labeled.into_iter().rev().take(limit).collect()
}

fn patterns(candles: &[Candle]) -> Vec<Pattern> {
    let mut out = Vec::new();
    let start = candles.len().saturating_sub(30).max(1);
    for index in start..candles.len() {
        let current = &candles[index];
        let previous = &candles[index - 1];
        let body = (current.close - current.open).abs();
        let range = (current.high - current.low).max(1e-9);
        let prev_body = (previous.close - previous.open).abs();
        let bullish = current.close > current.open;
        let bearish = current.close < current.open;
        let prev_bullish = previous.close > previous.open;
        let prev_bearish = previous.close < previous.open;

        if bullish
            && prev_bearish
            && current.open <= previous.close
            && current.close >= previous.open
            && body > prev_body
        {
            out.push(Pattern { index, kind: "bullishEngulfing", direction: "bullish" });
        } else if bearish
            && prev_bullish
            && current.open >= previous.close
            && current.close <= previous.open
            && body > prev_body
        {
            out.push(Pattern { index, kind: "bearishEngulfing", direction: "bearish" });
        }

        let lower_wick = current.open.min(current.close) - current.low;
        let upper_wick = current.high - current.open.max(current.close);
        if lower_wick > body * 2.0 && lower_wick > range * 0.55 {
            out.push(Pattern { index, kind: "bullishPin", direction: "bullish" });
        } else if upper_wick > body * 2.0 && upper_wick > range * 0.55 {
            out.push(Pattern { index, kind: "bearishPin", direction: "bearish" });
        } else if body < range * 0.1 {
            out.push(Pattern { index, kind: "doji", direction: "neutral" });
        } else if current.high < previous.high && current.low > previous.low {
            out.push(Pattern { index, kind: "insideBar", direction: "neutral" });
        }
    }
    out.into_iter().rev().take(8).collect()
}

fn cluster_levels(swings: &[SwingPoint], tolerance: f64, price: f64, limit: usize) -> Vec<Level> {
    let mut used = vec![false; swings.len()];
    let mut levels: Vec<Level> = Vec::new();
    for index in (0..swings.len()).rev() {
        if used[index] {
            continue;
        }
        let swing = &swings[index];
        let mut touches = 1usize;
        let mut last_index = swing.index;
        used[index] = true;
        for other in (0..index).rev() {
            if used[other] {
                continue;
            }
            if swings[other].kind == swing.kind && (swings[other].price - swing.price).abs() <= tolerance {
                touches += 1;
                last_index = last_index.max(swings[other].index);
                used[other] = true;
            }
        }
        if touches >= 2 {
            levels.push(Level {
                price: round_to(swing.price, 4),
                kind: if swing.price >= price { "resistance" } else { "support" },
                touches,
                last_index,
            });
        }
    }
    levels.into_iter().take(limit).collect()
}

fn fair_value_gaps(candles: &[Candle]) -> Vec<Fvg> {
    let mut out = Vec::new();
    for index in 2..candles.len() {
        let first = &candles[index - 2];
        let third = &candles[index];
        if first.high < third.low {
            let top = third.low;
            let bottom = first.high;
            let lowest = candles[index + 1..]
                .iter()
                .map(|c| c.low)
                .fold(f64::MAX, f64::min);
            let penetration = if lowest.is_finite() {
                ((top - lowest.max(bottom)) / (top - bottom)).clamp(0.0, 1.0)
            } else {
                0.0
            };
            out.push(Fvg {
                from: index - 2,
                to: index,
                top: round_to(top, 4),
                bottom: round_to(bottom, 4),
                direction: "bullish",
                filled: round_to(penetration, 2),
            });
        } else if first.low > third.high {
            let top = first.low;
            let bottom = third.high;
            let highest = candles[index + 1..]
                .iter()
                .map(|c| c.high)
                .fold(f64::MIN, f64::max);
            let penetration = if highest.is_finite() {
                ((highest.min(top) - bottom) / (top - bottom)).clamp(0.0, 1.0)
            } else {
                0.0
            };
            out.push(Fvg {
                from: index - 2,
                to: index,
                top: round_to(top, 4),
                bottom: round_to(bottom, 4),
                direction: "bearish",
                filled: round_to(penetration, 2),
            });
        }
    }
    out.into_iter().rev().take(8).collect()
}

fn order_blocks(candles: &[Candle], breaks: &[Break]) -> Vec<OrderBlock> {
    let mut out: Vec<OrderBlock> = Vec::new();
    for item in breaks.iter().rev() {
        let bullish = item.direction == "bullish";
        let start = item.index.saturating_sub(10);
        for cursor in (start..item.index).rev() {
            let candle = &candles[cursor];
            let matches = if bullish {
                candle.close < candle.open
            } else {
                candle.close > candle.open
            };
            if matches {
                if !out.iter().any(|block| block.index == cursor) {
                    out.push(OrderBlock {
                        index: cursor,
                        top: round_to(candle.high, 4),
                        bottom: round_to(candle.low, 4),
                        direction: item.direction,
                    });
                }
                break;
            }
        }
        if out.len() >= 6 {
            break;
        }
    }
    out
}

fn liquidity_levels(swings: &[SwingPoint], atr: f64, n: usize) -> Vec<Liquidity> {
    let tolerance = atr * 0.15;
    let mut out = Vec::new();
    let mut used = vec![false; swings.len()];
    for index in (0..swings.len()).rev() {
        if used[index] || swings[index].index > n {
            continue;
        }
        let swing = &swings[index];
        let mut touches = 1usize;
        for other in (0..index).rev() {
            if used[other] {
                continue;
            }
            if swings[other].kind == swing.kind && (swings[other].price - swing.price).abs() <= tolerance {
                touches += 1;
                used[other] = true;
            }
        }
        used[index] = true;
        if touches >= 2 {
            out.push(Liquidity {
                price: round_to(swing.price, 4),
                kind: if swing.kind == "high" { "bsl" } else { "ssl" },
                touches,
                index: swing.index,
            });
        }
        if out.len() >= 6 {
            break;
        }
    }
    out
}

fn liquidity_sweeps(candles: &[Candle], swings: &[SwingPoint], horizon: usize) -> Vec<Sweep> {
    let mut out = Vec::new();
    for swing in swings.iter().rev() {
        let end = (swing.index + horizon + 1).min(candles.len());
        for index in swing.index + 1..end {
            let candle = &candles[index];
            if swing.kind == "high" && candle.high > swing.price && candle.close < swing.price {
                out.push(Sweep {
                    index,
                    price: round_to(swing.price, 4),
                    direction: "bearish",
                    kind: "above",
                });
                break;
            }
            if swing.kind == "low" && candle.low < swing.price && candle.close > swing.price {
                out.push(Sweep {
                    index,
                    price: round_to(swing.price, 4),
                    direction: "bullish",
                    kind: "below",
                });
                break;
            }
        }
        if out.len() >= 6 {
            break;
        }
    }
    out
}

fn recent_range(candles: &[Candle], lookback: usize) -> (f64, f64) {
    let start = candles.len().saturating_sub(lookback);
    let high = candles[start..].iter().map(|c| c.high).fold(f64::MIN, f64::max);
    let low = candles[start..].iter().map(|c| c.low).fold(f64::MAX, f64::min);
    (high, low)
}

fn session_label(time: i64) -> &'static str {
    let hour = (time / 3600).rem_euclid(24);
    match hour {
        0..=6 => "asia",
        7..=11 => "london",
        12..=16 => "newYork",
        _ => "late",
    }
}

// ---------------------------------------------------------------------------
// Order flow proxy
// ---------------------------------------------------------------------------

fn delta_series(candles: &[Candle]) -> Vec<f64> {
    candles
        .iter()
        .map(|candle| {
            let range = (candle.high - candle.low).max(1e-9);
            let buy = candle.volume * ((candle.close - candle.low) / range).clamp(0.0, 1.0);
            let sell = candle.volume - buy;
            buy - sell
        })
        .collect()
}

fn cumulative_delta(delta: &[f64]) -> Vec<Option<f64>> {
    let mut total = 0.0;
    delta
        .iter()
        .map(|value| {
            total += value;
            Some(round_to(total, 2))
        })
        .collect()
}

fn pressure(delta: &[f64], candles: &[Candle], lookback: usize) -> f64 {
    let start = candles.len().saturating_sub(lookback);
    let volume: f64 = candles[start..].iter().map(|c| c.volume).sum();
    if volume <= 0.0 {
        return 0.0;
    }
    (delta[start..].iter().sum::<f64>() / volume).clamp(-1.0, 1.0)
}

fn imbalance(delta: &[f64], candles: &[Candle], lookback: usize) -> f64 {
    let start = candles.len().saturating_sub(lookback);
    let mut buy = 0usize;
    let mut sell = 0usize;
    for index in start..candles.len() {
        let volume = candles[index].volume.max(1.0);
        if delta[index] / volume > 0.35 {
            buy += 1;
        } else if delta[index] / volume < -0.35 {
            sell += 1;
        }
    }
    let total = (buy + sell).max(1) as f64;
    ((buy as f64 - sell as f64) / total).clamp(-1.0, 1.0)
}

fn volume_profile(candles: &[Candle], buckets: usize) -> (Vec<ProfileBar>, f64, f64, f64) {
    let lookback = candles.len().min(240);
    let start = candles.len() - lookback;
    let (high, low) = recent_range(candles, lookback);
    if high <= low || buckets == 0 {
        return (Vec::new(), 0.0, 0.0, 0.0);
    }
    let width = (high - low) / buckets as f64;
    let mut volumes = vec![0.0f64; buckets];
    for candle in &candles[start..] {
        let first = (((candle.low - low) / width).floor() as i64).clamp(0, buckets as i64 - 1) as usize;
        let last = (((candle.high - low) / width).floor() as i64).clamp(0, buckets as i64 - 1) as usize;
        let span = (last - first + 1) as f64;
        for bucket in first..=last {
            volumes[bucket] += candle.volume / span;
        }
    }
    let total: f64 = volumes.iter().sum();
    let mut order: Vec<usize> = (0..buckets).collect();
    order.sort_by(|a, b| volumes[*b].partial_cmp(&volumes[*a]).unwrap_or(std::cmp::Ordering::Equal));
    let mut selected = vec![false; buckets];
    let mut accumulated = 0.0;
    for bucket in order {
        if accumulated >= total * 0.7 {
            break;
        }
        selected[bucket] = true;
        accumulated += volumes[bucket];
    }
    let poc_index = volumes
        .iter()
        .enumerate()
        .max_by(|a, b| a.1.partial_cmp(b.1).unwrap_or(std::cmp::Ordering::Equal))
        .map(|(index, _)| index)
        .unwrap_or(0);
    let mut vah = low;
    let mut val = high;
    for index in 0..buckets {
        if selected[index] {
            let price = low + (index as f64 + 0.5) * width;
            vah = vah.max(price);
            val = val.min(price);
        }
    }
    let profile = (0..buckets)
        .map(|index| ProfileBar {
            price: round_to(low + (index as f64 + 0.5) * width, 4),
            volume: round_to(volumes[index], 1),
            in_value_area: selected[index],
            is_poc: index == poc_index,
        })
        .collect();
    let poc = low + (poc_index as f64 + 0.5) * width;
    (profile, round_to(poc, 4), round_to(vah, 4), round_to(val, 4))
}

fn absorptions(candles: &[Candle], atr: &[Option<f64>], volume_sma: &[Option<f64>]) -> Vec<Absorption> {
    let mut out = Vec::new();
    let start = candles.len().saturating_sub(30);
    for index in start..candles.len() {
        let (Some(avg_volume), Some(avg_range)) = (volume_sma[index], atr[index]) else {
            continue;
        };
        let candle = &candles[index];
        let range = candle.high - candle.low;
        if avg_volume > 0.0 && candle.volume > avg_volume * 1.6 && range < avg_range * 0.7 {
            out.push(Absorption {
                index,
                price: round_to(candle.close, 4),
                direction: if candle.close >= candle.open { "bullish" } else { "bearish" },
            });
        }
    }
    out.into_iter().rev().take(5).collect()
}

fn divergence(candles: &[Candle], swings: &[SwingPoint], cumulative: &[Option<f64>]) -> &'static str {
    let highs: Vec<&SwingPoint> = swings.iter().filter(|s| s.kind == "high").rev().take(2).collect();
    if highs.len() == 2 {
        let (later, earlier) = (highs[0], highs[1]);
        if let (Some(later_delta), Some(earlier_delta)) = (cumulative[later.index], cumulative[earlier.index]) {
            if later.price > earlier.price && later_delta < earlier_delta {
                return "bearish";
            }
        }
    }
    let lows: Vec<&SwingPoint> = swings.iter().filter(|s| s.kind == "low").rev().take(2).collect();
    if lows.len() == 2 {
        let (later, earlier) = (lows[0], lows[1]);
        if let (Some(later_delta), Some(earlier_delta)) = (cumulative[later.index], cumulative[earlier.index]) {
            if later.price < earlier.price && later_delta > earlier_delta {
                return "bullish";
            }
        }
    }
    let _ = candles;
    "none"
}

// ---------------------------------------------------------------------------
// Confluence
// ---------------------------------------------------------------------------

#[allow(clippy::too_many_arguments)]
fn build_bias(
    trend: &'static str,
    structure: &'static str,
    ema_alignment: &'static str,
    premium_discount: f64,
    sweeps: &[Sweep],
    pressure: f64,
    rsi: Option<f64>,
    macd_hist: Option<f64>,
    divergence: &'static str,
) -> Bias {
    let mut reasons = Vec::new();
    let mut score = 0.0;

    if structure == "hh_hl" || trend == "bullish" {
        score += 18.0;
        reasons.push(Reason { code: "structureBullish", points: 18.0, value: 0.0 });
    } else if structure == "lh_ll" || trend == "bearish" {
        score -= 18.0;
        reasons.push(Reason { code: "structureBearish", points: -18.0, value: 0.0 });
    }

    if ema_alignment == "bullish" {
        score += 12.0;
        reasons.push(Reason { code: "emaBullish", points: 12.0, value: 0.0 });
    } else if ema_alignment == "bearish" {
        score -= 12.0;
        reasons.push(Reason { code: "emaBearish", points: -12.0, value: 0.0 });
    }

    if premium_discount < 0.35 {
        score += 10.0;
        reasons.push(Reason { code: "zoneDiscount", points: 10.0, value: round_to(premium_discount * 100.0, 1) });
    } else if premium_discount > 0.65 {
        score -= 10.0;
        reasons.push(Reason { code: "zonePremium", points: -10.0, value: round_to(premium_discount * 100.0, 1) });
    }

    if let Some(latest) = sweeps.first() {
        if latest.direction == "bullish" {
            score += 8.0;
            reasons.push(Reason { code: "sweepBullish", points: 8.0, value: latest.price });
        } else {
            score -= 8.0;
            reasons.push(Reason { code: "sweepBearish", points: -8.0, value: latest.price });
        }
    }

    let flow_points = (pressure * 30.0).clamp(-30.0, 30.0);
    if flow_points.abs() >= 4.0 {
        score += flow_points;
        reasons.push(Reason {
            code: if flow_points > 0.0 { "flowBuying" } else { "flowSelling" },
            points: round_to(flow_points, 1),
            value: round_to(pressure, 2),
        });
    }

    if let Some(value) = rsi {
        if value > 55.0 {
            score += 5.0;
            reasons.push(Reason { code: "momentumBullish", points: 5.0, value: round_to(value, 1) });
        } else if value < 45.0 {
            score -= 5.0;
            reasons.push(Reason { code: "momentumBearish", points: -5.0, value: round_to(value, 1) });
        }
    }
    if let Some(value) = macd_hist {
        if value > 0.0 {
            score += 5.0;
        } else if value < 0.0 {
            score -= 5.0;
        }
    }

    match divergence {
        "bullish" => {
            score += 8.0;
            reasons.push(Reason { code: "divergenceBullish", points: 8.0, value: 0.0 });
        }
        "bearish" => {
            score -= 8.0;
            reasons.push(Reason { code: "divergenceBearish", points: -8.0, value: 0.0 });
        }
        _ => {}
    }

    let score = score.clamp(-100.0, 100.0);
    let direction = if score > 20.0 {
        "bullish"
    } else if score < -20.0 {
        "bearish"
    } else {
        "neutral"
    };
    if reasons.is_empty() {
        reasons.push(Reason { code: "neutral", points: 0.0, value: 0.0 });
    }
    Bias {
        direction,
        score: round_to(score, 1),
        confidence: round_to(score.abs(), 1),
        reasons,
    }
}

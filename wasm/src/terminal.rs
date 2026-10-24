//! Terminal timeframe aggregation.
//!
//! The TypeScript boundary validates the tape and resolves every bar's
//! session-anchored bucket start (America/Chicago calendar, DST, weekends). This
//! module owns only the O(n) reduce, keeping timezone work out of Rust and out of
//! the wasm binary.
//!
//! Prices cross the JSON ABI as base64-encoded little-endian `f64` bytes rather
//! than JSON numbers. `serde_json`'s default number parser is approximate for
//! some decimal fractions; enabling its exact-roundtrip feature costs more wasm
//! size than the whole aggregate export. A byte encoding is exact, compact, and
//! avoids the float parser entirely.

use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AggregateRequest {
    bucket_starts: Vec<i64>,
    open: String,
    high: String,
    low: String,
    close: String,
    volume: String,
}

#[derive(Serialize)]
struct AggregateResponse {
    time: Vec<i64>,
    open: Vec<f64>,
    high: Vec<f64>,
    low: Vec<f64>,
    close: Vec<f64>,
    volume: Vec<f64>,
}

fn decode_base64(encoded: &str) -> Result<Vec<u8>, String> {
    let mut output = Vec::with_capacity(encoded.len() * 3 / 4);
    let mut accumulator: u32 = 0;
    let mut bits = 0u32;
    for byte in encoded.bytes() {
        let value = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' => break,
            b'\n' | b'\r' => continue,
            _ => return Err("aggregate column is not valid base64".to_string()),
        };
        accumulator = (accumulator << 6) | u32::from(value);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            output.push((accumulator >> bits) as u8);
            accumulator &= (1 << bits) - 1;
        }
    }
    Ok(output)
}

fn decode_column(encoded: &str, length: usize) -> Result<Vec<f64>, String> {
    let bytes = decode_base64(encoded)?;
    if bytes.len() != length * 8 {
        return Err("aggregate columns must have equal length".to_string());
    }
    let mut values = Vec::with_capacity(length);
    for chunk in bytes.chunks_exact(8) {
        let mut word = [0u8; 8];
        word.copy_from_slice(chunk);
        values.push(f64::from_le_bytes(word));
    }
    Ok(values)
}

fn all_finite(values: &[f64]) -> bool {
    values.iter().all(|value| value.is_finite())
}

pub(crate) fn aggregate_json(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let request: AggregateRequest =
        serde_json::from_slice(bytes).map_err(|error| error.to_string())?;
    let length = request.bucket_starts.len();
    let open = decode_column(&request.open, length)?;
    let high = decode_column(&request.high, length)?;
    let low = decode_column(&request.low, length)?;
    let close = decode_column(&request.close, length)?;
    let volume = decode_column(&request.volume, length)?;
    if !all_finite(&open)
        || !all_finite(&high)
        || !all_finite(&low)
        || !all_finite(&close)
        || !all_finite(&volume)
    {
        return Err("aggregate OHLCV must be finite".to_string());
    }
    if volume.iter().any(|value| *value < 0.0) {
        return Err("aggregate volume must be nonnegative".to_string());
    }

    let mut time = Vec::with_capacity(length);
    let mut out_open = Vec::with_capacity(length);
    let mut out_high = Vec::with_capacity(length);
    let mut out_low = Vec::with_capacity(length);
    let mut out_close = Vec::with_capacity(length);
    let mut out_volume = Vec::with_capacity(length);

    let mut index = 0;
    while index < length {
        let start = request.bucket_starts[index];
        let bar_open = open[index];
        let mut bar_high = high[index];
        let mut bar_low = low[index];
        let mut bar_close = close[index];
        let mut bar_volume = volume[index];

        let mut cursor = index + 1;
        while cursor < length && request.bucket_starts[cursor] == start {
            if high[cursor] > bar_high {
                bar_high = high[cursor];
            }
            if low[cursor] < bar_low {
                bar_low = low[cursor];
            }
            bar_close = close[cursor];
            bar_volume += volume[cursor];
            if !bar_volume.is_finite() {
                return Err("aggregate volume overflow".to_string());
            }
            cursor += 1;
        }
        if cursor < length && request.bucket_starts[cursor] < start {
            return Err("aggregate bucketStarts must be non-decreasing".to_string());
        }

        time.push(start);
        out_open.push(bar_open);
        out_high.push(bar_high);
        out_low.push(bar_low);
        out_close.push(bar_close);
        out_volume.push(bar_volume);
        index = cursor;
    }

    serde_json::to_vec(&AggregateResponse {
        time,
        open: out_open,
        high: out_high,
        low: out_low,
        close: out_close,
        volume: out_volume,
    })
    .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    fn encode(values: &[f64]) -> String {
        const TABLE: &[u8; 64] =
            b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut bytes = Vec::with_capacity(values.len() * 8);
        for value in values {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        let mut encoded = String::with_capacity((bytes.len() + 2) / 3 * 4);
        for chunk in bytes.chunks(3) {
            let first = u32::from(chunk[0]);
            let second = u32::from(*chunk.get(1).unwrap_or(&0));
            let third = u32::from(*chunk.get(2).unwrap_or(&0));
            let triple = (first << 16) | (second << 8) | third;
            encoded.push(TABLE[((triple >> 18) & 63) as usize] as char);
            encoded.push(TABLE[((triple >> 12) & 63) as usize] as char);
            encoded.push(if chunk.len() > 1 {
                TABLE[((triple >> 6) & 63) as usize] as char
            } else {
                '='
            });
            encoded.push(if chunk.len() > 2 {
                TABLE[(triple & 63) as usize] as char
            } else {
                '='
            });
        }
        encoded
    }

    fn request(
        bucket_starts: &[i64],
        open: &[f64],
        high: &[f64],
        low: &[f64],
        close: &[f64],
        volume: &[f64],
    ) -> Value {
        json!({
            "bucketStarts": bucket_starts,
            "open": encode(open),
            "high": encode(high),
            "low": encode(low),
            "close": encode(close),
            "volume": encode(volume)
        })
    }

    fn run(request: Value) -> Result<Value, String> {
        let bytes = serde_json::to_vec(&request).map_err(|error| error.to_string())?;
        let output = aggregate_json(&bytes)?;
        serde_json::from_slice(&output).map_err(|error| error.to_string())
    }

    #[test]
    fn reduces_adjacent_bars_into_their_bucket() {
        let value = run(request(
            &[0, 0, 900, 900, 900],
            &[10.0, 11.0, 12.0, 13.0, 14.0],
            &[11.0, 12.0, 13.0, 14.0, 15.0],
            &[9.0, 10.0, 11.0, 12.0, 13.0],
            &[10.5, 11.5, 12.5, 13.5, 14.5],
            &[1.0, 2.0, 3.0, 4.0, 5.0],
        ))
        .unwrap();
        assert_eq!(value["time"], json!([0, 900]));
        assert_eq!(value["open"], json!([10.0, 12.0]));
        assert_eq!(value["high"], json!([12.0, 15.0]));
        assert_eq!(value["low"], json!([9.0, 11.0]));
        assert_eq!(value["close"], json!([11.5, 14.5]));
        assert_eq!(value["volume"], json!([3.0, 12.0]));
    }

    #[test]
    fn preserves_exact_float_bits() {
        let price = 19979.92415128165f64;
        let value = run(request(
            &[0, 0],
            &[price, price],
            &[price, price],
            &[price, price],
            &[price, price],
            &[1.0, 1.0],
        ))
        .unwrap();
        assert_eq!(
            value["close"][0].as_f64().unwrap().to_bits(),
            price.to_bits()
        );
    }

    #[test]
    fn rejects_mismatched_columns() {
        let error = run(request(&[0], &[1.0], &[1.0], &[1.0], &[], &[1.0])).unwrap_err();
        assert!(error.contains("equal length"));
    }

    #[test]
    fn accepts_empty_input() {
        let value = run(request(&[], &[], &[], &[], &[], &[])).unwrap();
        assert_eq!(value["time"], json!([]));
        assert_eq!(value["volume"], json!([]));
    }

    #[test]
    fn rejects_decreasing_buckets() {
        let error = run(request(
            &[900, 0],
            &[1.0, 1.0],
            &[1.0, 1.0],
            &[1.0, 1.0],
            &[1.0, 1.0],
            &[1.0, 1.0],
        ))
        .unwrap_err();
        assert!(error.contains("non-decreasing"));
    }

    #[test]
    fn rejects_non_finite_values() {
        let error = run(request(&[0], &[1.0], &[1.0], &[1.0], &[1.0], &[f64::NAN])).unwrap_err();
        assert!(error.contains("finite"));
    }

    #[test]
    fn rejects_invalid_base64() {
        let mut value = request(&[0], &[1.0], &[1.0], &[1.0], &[1.0], &[1.0]);
        value["open"] = json!("!!!!");
        let error = run(value).unwrap_err();
        assert!(error.contains("base64"));
    }
}

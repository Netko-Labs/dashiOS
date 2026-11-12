//! Numbers in and out of a model, with errors as words.

use ort::session::SessionOutputs;
use ort::value::Tensor;

pub(crate) fn words(error: impl std::fmt::Display) -> String {
    format!("the model failed: {error}")
}

pub(crate) fn floats(shape: &[usize], data: Vec<f32>) -> Result<Tensor<f32>, String> {
    Tensor::from_array((shape.to_vec(), data)).map_err(words)
}

pub(crate) fn longs(shape: &[usize], data: Vec<i64>) -> Result<Tensor<i64>, String> {
    Tensor::from_array((shape.to_vec(), data)).map_err(words)
}

pub(crate) fn ints(shape: &[usize], data: Vec<i32>) -> Result<Tensor<i32>, String> {
    Tensor::from_array((shape.to_vec(), data)).map_err(words)
}

/// One output's shape and its numbers, copied out.
pub(crate) fn output(
    outputs: &SessionOutputs,
    name: &str,
) -> Result<(Vec<usize>, Vec<f32>), String> {
    let value = outputs
        .get(name)
        .ok_or_else(|| format!("the model gave no {name}"))?;
    let (shape, data) = value.try_extract_tensor::<f32>().map_err(words)?;
    let shape = shape.iter().map(|side| (*side).max(0) as usize).collect();
    Ok((shape, data.to_vec()))
}

/// The place of the largest number; 0 for none.
pub(crate) fn argmax(values: &[f32]) -> usize {
    let mut best = 0;
    for (at, value) in values.iter().enumerate() {
        if *value > values[best] {
            best = at;
        }
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_first_of_the_largest_wins() {
        assert_eq!(argmax(&[0.1, 0.9, 0.9, -1.0]), 1);
        assert_eq!(argmax(&[]), 0);
    }
}

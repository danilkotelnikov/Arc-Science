//! Embedding provider trait.
//!
//! The engine stores and searches vectors but does not itself own a model. A
//! concrete `Embedder` pins a model identity, so the engine can tag a searchable
//! *generation*; vectors from different models never share a generation. The real
//! local model is provisioned explicitly (no silent download); tests use a
//! deterministic, model-free embedder.
use crate::error::Result;

pub trait Embedder {
    /// Stable identity of the model+pipeline (used as the generation key).
    fn model_id(&self) -> &str;
    /// Vector dimension this embedder produces.
    fn dim(&self) -> usize;
    /// Embed a batch of texts, returning one vector per input in order.
    fn embed(&self, texts: &[&str]) -> Result<Vec<Vec<f32>>>;
}

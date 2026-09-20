pub mod acquire;
pub mod bioart;
pub mod config;
pub mod containment;
pub mod discover;
pub mod process;
pub mod settings;

pub type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

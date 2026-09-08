pub mod acquire;
pub mod bioart;
pub mod config;
pub mod process;

pub type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

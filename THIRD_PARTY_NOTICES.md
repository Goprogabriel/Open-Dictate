# Third-party notices

Open Dictate is built with open-source packages declared in `package.json`,
`functions/package.json`, and `src-tauri/Cargo.toml`. Exact resolved versions are recorded in the
corresponding lockfiles. Each dependency remains subject to its own license and copyright; the
Open Dictate MIT license does not replace those terms.

## Downloaded Local AI models

Model files are not stored in this repository or bundled in the installer. When a user enables
Local AI, the application downloads the selected files directly from the publishers, verifies
their byte length and SHA-256 digest, and stores them in the private application-data directory.

- Whisper models are published by the
  [whisper.cpp project](https://github.com/ggerganov/whisper.cpp) under the MIT License. The
  original Whisper model and code are published by OpenAI under the MIT License.
- Qwen3 GGUF models are published by the [Qwen team](https://huggingface.co/Qwen) under the
  Apache License 2.0. Each model repository's model card and license apply to the downloaded file.

The local runtime uses the `whisper-rs` and `llama-cpp-2` Rust crates, which wrap whisper.cpp and
llama.cpp respectively. Their exact versions and licenses are recorded in `src-tauri/Cargo.lock`
and their upstream distributions.

## Services and trademarks

Firebase, Stripe, OpenAI, Apple, macOS, Microsoft, and Windows are trademarks of their respective
owners. Their mention describes optional interoperability and does not imply endorsement. Anyone
deploying the managed backend must review and accept the current terms for the services they
choose to configure.

If a notice is missing or inaccurate, please open an issue. License-compliance fixes are treated
as release-blocking.

fn main() {
    // Re-trigger build when icons or config change
    println!("cargo:rerun-if-changed=tauri.conf.json");
    println!("cargo:rerun-if-changed=icons/icon.ico");
    tauri_build::build();
}


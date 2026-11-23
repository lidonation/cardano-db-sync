fn main() {
    let mut args = std::env::args().skip(1);
    let spec = std::fs::read_to_string(args.next().expect("schema path")).unwrap();
    for name in args {
        let bytes = std::fs::read(&name).unwrap();
        cddl_cat::validate_cbor_bytes("metadata", &spec, &bytes).expect(&name);
        println!("PASS {}", name);
    }
}

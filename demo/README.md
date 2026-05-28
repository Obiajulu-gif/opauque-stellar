# Opaque Demo — ZK Proof Verification

This demo showcases Groth16 proof verification using snarkjs.

## Security Notes

- The demo loads `snarkjs` and its transitive dependencies (`ethers`, `bfj`, `jsonpath`, `underscore`)
  only during proof generation. These packages are NOT loaded on the main application page and do
  not affect the wallet's attack surface.
- Production deployments should serve the demo from an isolated subdomain to prevent
  any cross-origin impact on the main Opaque wallet application.

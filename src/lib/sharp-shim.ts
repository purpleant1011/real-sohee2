// Cloudflare Worker Shim for Sharp (V8 Isolate does not support native C++ binaries)
export default function sharp() {
  throw new Error('Sharp is not supported in Cloudflare Workers V8 runtime');
}

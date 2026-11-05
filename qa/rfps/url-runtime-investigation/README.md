# URL retrieval runtime investigation

Run locally only. No deployments, bindings, accounts or credentials are needed. These probes read public example.com or the public user-supplied Pathway grant page. They do not accept arbitrary URLs or read uploaded documents.

Pinned dependencies installed outside the application in `/tmp/rfp-workers-probe`: Miniflare 4.20260730.0 / workerd 1.20260730.1. Compatibility date 2026-07-30 is the latest supported by this available emulator; CMD's generated target date is 2026-11-01. This does not establish behavior of the managed live runtime.

Reproduce after installing that exact Miniflare package into a temporary directory:

```sh
node qa/rfps/url-runtime-investigation/node-pinned.mjs /tmp/rfp-workers-probe
node qa/rfps/url-runtime-investigation/node-hostname-control.mjs /tmp/rfp-workers-probe
node qa/rfps/url-runtime-investigation/native-pinned.mjs /tmp/rfp-workers-probe
node qa/rfps/url-runtime-investigation/native-wrong-hostname.mjs /tmp/rfp-workers-probe
node qa/rfps/url-runtime-investigation/native-pathway.mjs /tmp/rfp-workers-probe
```

Observed 2026-11-05:

| Probe | Observed result | Interpretation |
|---|---|---|
| Node TLS to resolved public IP, original hostname | TLS handshake failure | Not a working replacement for the existing Node HTTPS transport |
| Node TLS to hostname (control) | HTTP 200, authorized true | Networking works; using this would lose IP pinning and is not accepted |
| Native socket to public IP, startTls expectedServerHostname example.com | HTTP 200 **plus unsupported-option warning** | Experimental mechanism, not a supported production contract |
| Native socket with deliberately wrong expected hostname | Handshake failure **plus unsupported-option warning** | Negative check passes locally, but does not remove the unsupported-API limitation |
| Native socket to Pathway public IP with correct expected hostname | HTTP 200 **plus unsupported-option warning** | Public source can be read locally, not a supported production-ready reader |

Official current workerd source `src/workerd/api/sockets.c++` explicitly warns for `expectedServerHostname` and has an autogate that rejects it. Do not use it as a production dependency merely because this emulator allowed it. Native outbound sockets also exclude Cloudflare IP ranges in hosted Workers, further limiting coverage.

Supported fetch cannot pin arbitrary external destinations: `cf.resolveOverride` only applies when both hosts are in the worker's zone. A DNS pre-check followed by normal fetch does not prevent rebinding. No fallback to unrestricted fetch was introduced.

References:
- https://developers.cloudflare.com/workers/runtime-apis/nodejs/dns/
- https://developers.cloudflare.com/workers/runtime-apis/nodejs/https/
- https://developers.cloudflare.com/workers/runtime-apis/request/#the-cf-property-requestinitcfproperties
- https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/
- https://raw.githubusercontent.com/cloudflare/workerd/main/src/workerd/api/sockets.c++

The active local application candidate therefore performs no external URL fetch: the endpoint returns 501 after authentication/authorization. URL references and explicitly pasted text remain usable; file intake uses local browser extraction and existing private Supabase storage upon save.

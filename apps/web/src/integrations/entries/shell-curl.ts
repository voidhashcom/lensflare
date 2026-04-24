import type { Integration } from "../types";

/**
 * Raw curl against the Axiom-native ingest endpoint. Doubles as a sanity
 * check for "is the server reachable from my machine" — if this works,
 * the SDK-flavoured integrations will too. The Axiom path is chosen over
 * OTLP because OTLP requires a protobuf body, while the Axiom endpoint
 * takes plain JSON arrays, which is far friendlier to paste in a shell.
 */
const shellCurl: Integration = {
  id: "shell-curl",
  language: "shell",
  library: {
    id: "curl",
    label: "curl",
    homepageUrl: "https://curl.se/",
  },
  protocol: "axiom-native",
  signals: ["logs"],
  summary:
    "Hand-craft a single POST to prove connectivity and see an event appear in the live tab.",
  steps: [
    {
      title: "Send a single event",
      body: "This posts a one-element JSON array to the Axiom-native ingest endpoint. The `_time` field is optional — if you omit it, Lensflare uses the server's receipt time.",
      snippet: {
        lang: "bash",
        code: `curl -X POST "{{serverOrigin}}/ingest/axiom/v1/ingest/{{datasetSlug}}" \\
  -H "Authorization: Bearer {{bearerToken}}" \\
  -H "Content-Type: application/json" \\
  -d '[
    {
      "_time": "'"$(date -u +"%Y-%m-%dT%H:%M:%SZ")"'",
      "level": "info",
      "message": "Hello from curl",
      "service": "my-service"
    }
  ]'`,
      },
    },
    {
      title: "Batch a handful of events",
      body: "NDJSON lets you stream many events without loading them into memory first. Use `Content-Type: application/x-ndjson` and separate every JSON object with a newline.",
      snippet: {
        lang: "bash",
        code: `curl -X POST "{{serverOrigin}}/ingest/axiom/v1/ingest/{{datasetSlug}}" \\
  -H "Authorization: Bearer {{bearerToken}}" \\
  -H "Content-Type: application/x-ndjson" \\
  --data-binary @- <<'EOF'
{"level":"info","message":"Batch line 1"}
{"level":"warn","message":"Batch line 2"}
{"level":"error","message":"Batch line 3"}
EOF`,
      },
      note:
        "A successful request returns `204 No Content`. Anything else comes back with a JSON body describing what went wrong.",
    },
  ],
  verifyHint:
    "You should see the events land in the live tab within a second of sending the request.",
};

export default shellCurl;

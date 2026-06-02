# Payment Processor Subgraph

A [The Graph](https://thegraph.com) subgraph that indexes on-chain events from the Sapphire DAO payment processor contracts. It exposes a queryable GraphQL API for invoice lifecycle data, dispute history, payment tokens, encrypted notes, multisig governance, and dashboard metrics.

For the entity reference, invoice state machines, metrics, and example queries, see **[DOCUMENTATION.md](DOCUMENTATION.md)**. This README covers setup, configuration, and deployment only.

## Project Structure

```
├── schema.graphql                    # GraphQL entity definitions
├── subgraph.template.yaml            # Manifest template ({{network}}, {{…address}}, …)
├── subgraph.yaml                     # Generated from the template (git-ignored)
├── config/                           # Per-network values
│   ├── localhost.json
│   └── base-sepolia.json
├── abis/                             # Contract ABIs
├── src/
│   ├── simple-payment-processor.ts   # SimplePaymentProcessor event handlers
│   ├── advanced-payment-processor.ts # AdvancedPaymentProcessor event handlers
│   ├── notes.ts                      # Notes contract handlers
│   ├── multi-sig.ts                  # MultiSig contract handlers
│   ├── oracle-manager.ts             # OracleManager (PriceFeedSet) handler
│   └── util/
│       ├── storage.ts                # On-chain storage reads (hold period, fee rate)
│       ├── token.ts                  # ERC20 token metadata reads
│       └── metrics.ts                # Dashboard metric aggregation helpers
├── docker-compose.yml                # Local Graph Node + IPFS + Postgres
└── generated/                        # Auto-generated types (do not edit)
```

## Prerequisites

- Node.js ≥ 18
- [Bun](https://bun.sh)
- Docker (for a local Graph Node)

## Setup

```bash
bun install
```

## Configuration (multi-network)

`subgraph.yaml` is **generated** from `subgraph.template.yaml` and a per-network config file in `config/`. The template holds `{{network}}`, `{{<dataSource>.address}}`, and `{{<dataSource>.startBlock}}` placeholders; the config supplies the values. `subgraph.yaml` is git-ignored — never edit it directly.

```bash
bun run prepare:localhost      # render subgraph.yaml for the local chain
bun run prepare:base-sepolia   # render subgraph.yaml for Base Sepolia
```

Addresses and start blocks live in `config/<network>.json`. To **add a network**: copy an existing config, fill in `network` and each data source's `address` / `startBlock`, then add a matching `prepare:<network>` script in `package.json`. Set `startBlock` to the contract deployment block to avoid re-indexing older history.

## Quick Start

```bash
bun run prepare:localhost   # pick the target network
bun run codegen             # generate types from schema + ABIs
bun run build               # compile mappings to WASM
```

To wipe generated artifacts and rebuild:

```bash
bun run clean && bun run codegen && bun run build
```

## Local Development with Docker

`docker-compose.yml` runs Graph Node + IPFS + Postgres and points Graph Node at your host chain via `localhost:http://host.docker.internal:8545` — `host.docker.internal` resolves to the host's `127.0.0.1:8545` (the reliable way to reach the host chain from a container on macOS/Windows). The manifest's `network:` must match the key (`localhost`).

```bash
# 1. Start your local chain (Anvil/Hardhat) on 127.0.0.1:8545 and deploy contracts
# 2. Render the manifest, generate types, and build
bun run prepare:localhost && bun run codegen && bun run build
# 3. Start Graph Node + IPFS + Postgres
docker compose up -d
# 4. Create and deploy the subgraph
bun run create-local
bunx graph deploy --node http://localhost:8020/ --ipfs http://localhost:5001 \
  --version-label v0.0.1 payment-processor
```

Query at `http://localhost:8000/subgraphs/name/payment-processor`.

> **Restarting the local chain invalidates Graph Node's indexed blocks** (block hashes change), surfacing as a `Provider went backwards` warning and a stuck sync. After restarting Anvil/Hardhat, reset Graph Node too:
>
> ```bash
> docker compose down && rm -rf data && docker compose up -d
> bun run create-local && bunx graph deploy --node http://localhost:8020/ \
>   --ipfs http://localhost:5001 --version-label v0.0.1 payment-processor
> ```
>
> To avoid this, run Anvil with persisted state: `anvil --state ./anvil-state.json`.

## Deployment to The Graph Studio

```bash
# Authenticate (one-time)
bunx graph auth --studio <deploy-key>

# Prepare the target network, then deploy
bun run prepare:base-sepolia
bun run codegen && bun run build
bun run deploy
```

To publish non-interactively, pass a version label:

```bash
bunx graph deploy --node https://api.studio.thegraph.com/deploy/ payment-processor --version-label 0.07
```

The `deploy:full` script (`scripts/deploy-subgraph.sh`) wraps the full build-and-deploy flow.

## Adding a New Event Handler

1. Add any new entity fields to `schema.graphql`.
2. Add the event to the relevant `eventHandlers` block in `subgraph.template.yaml`.
3. Run `bun run prepare:<network>` then `bun run codegen` to update generated types.
4. Write the handler in the appropriate `src/*.ts` file (append an `InvoiceEvent`, update metrics as needed).
5. Run `bun run build` to verify it compiles.

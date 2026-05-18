# Payment Processor Subgraph

A [The Graph](https://thegraph.com) subgraph that indexes on-chain events from the Sapphire DAO payment processor contracts on Base Sepolia. It exposes a queryable GraphQL API for invoice lifecycle data, dispute history, payment tokens, and encrypted notes.

## API Endpoints

| Environment | URL |
|---|---|
| Studio (`0.06`) | `https://api.studio.thegraph.com/query/100227/processor-indexer/0.06` |
| Local node | `http://localhost:8000/subgraphs/name/processor-indexer` |

## Indexed Contracts (Base Sepolia)

| Contract | Address | Start block |
|---|---|---|
| SimplePaymentProcessor | `0xd70c10c73a716f85d97b5619dadfb6b1b6b6a706` | `40636475` |
| AdvancedPaymentProcessor | `0x792af6df4f32ac3b8c2745dee42f9e08090c0746` | `40636475` |
| Notes | `0x8391a68c01834d252c1dff975a621e8f99020b65` | `40636475` |
| MultiSig | `0x331798ef8a2a46b6e6a5864ba7f03016b875f193` | `40669962` |
| PaymentProcessorStorage | `0x13676a686fa96408a70acbda6312b330d11ce390` | `40636475` |

Reference (not indexed, used by the contracts above):

| Contract | Address |
|---|---|
| OracleManager | `0xf45c248fa3adc3ddcee03044865b4a05f5611771` |
| MockUsdc | `0x41a196b1ff165419a1320f029e689a41f30c70b0` |
| MockWbtc | `0x8cdaf12598d71cad44e91fb1c05d565a383e3dba` |

## Quick Start

```bash
# Install dependencies
npm install

# Generate TypeScript types from schema and ABIs
npm run codegen

# Build the subgraph (compiles to WASM)
npm run build

# Deploy to The Graph Studio
npm run deploy
```

## Example Query

```graphql
{
  simplePaymentProcessors(first: 5, orderBy: createdAt, orderDirection: desc) {
    id
    state
    price
    seller { id }
    buyer { id }
    history
    historyTime
  }
}
```

## Project Structure

```
├── schema.graphql                    # GraphQL entity definitions
├── subgraph.yaml                     # Subgraph manifest (data sources + handlers)
├── abis/                             # Contract ABIs
├── src/
│   ├── simple-payment-processor.ts   # Handlers for SimplePaymentProcessor events
│   ├── advanced-payment-processor.ts # Handlers for AdvancedPaymentProcessor events
│   ├── notes.ts                      # Handlers for Notes contract events
│   ├── multi-sig.ts                  # Handlers for MultiSig contract events
│   └── util/
│       ├── storage.ts                # On-chain storage reads (hold period, fee rate)
│       └── token.ts                  # ERC20 token metadata reads
└── generated/                        # Auto-generated types (do not edit)
```

## Documentation

See [DOCUMENTATION.md](DOCUMENTATION.md) for the full entity reference, invoice state machines, example queries, and deployment guide.

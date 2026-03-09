# Payment Processor Subgraph

A [The Graph](https://thegraph.com) subgraph that indexes on-chain events from the Sapphire DAO payment processor contracts on Arbitrum Sepolia. It exposes a queryable GraphQL API for invoice lifecycle data, dispute history, payment tokens, and encrypted notes.

## API Endpoints

| Environment | URL |
|---|---|
| Studio (latest) | `https://api.studio.thegraph.com/query/100227/payment-processor/version/latest` |
| Local node | `http://localhost:8000/subgraphs/name/payment-processor` |

## Indexed Contracts (Arbitrum Sepolia)

| Contract | Address |
|---|---|
| SimplePaymentProcessor | `0xd4a9e5ac9f54beccd7c12ca6bd7bd026bbf0058d` |
| AdvancedPaymentProcessor | `0x3d07827e8a6ba46f37d129df8d99f4ee8aa5685f` |
| Notes | `0xbe210c16e990e74a92eb85060bb33eb03418c565` |

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
│   └── util/
│       ├── storage.ts                # On-chain storage reads (hold period, fee rate)
│       └── token.ts                  # ERC20 token metadata reads
└── generated/                        # Auto-generated types (do not edit)
```

## Documentation

See [DOCUMENTATION.md](DOCUMENTATION.md) for the full entity reference, invoice state machines, example queries, and deployment guide.

# Moonbeam Distribution Subql

Based on [SubQuery](https://www.subquery.network/) project defines for collect the crowdloan data from Heiko or Parallel Substrate blockchain

## Development

### Start project in Docker

```
docker-compose pull && docker-compose up
```

### Query data

open your browser and head to `http://localhost:3000`.

Finally, you should see a GraphQL playground is showing in the explorer and the schemas that ready to query.

```graphql
  query {
      claimTxes (first: 5) {
          nodes {
              id
              from
              to
              amount
          }
      }
      distributionTxes (first: 5) {
          nodes {
              id
              from
              to
              amount
          }
      }
  }
```

# Disaster Response Simulator

A disaster-response laboratory with a deterministic event engine, procedural maps, transport, communications, synthetic information sources, authorized actions, independent evaluation and an isometric 3D observer.

The simulator models operational interactions. Graphics use simple geometry. Synthetic media descriptions do not validate real audio/video perception, and laboratory outcomes do not establish field effectiveness.

## Development

Requires Node.js 24 or later. Install dependencies with `pnpm install`.

```sh
pnpm start
pnpm test
pnpm check
```

The observer, synthetic source gateway and command-line tools are documented as their implementation is verified. Run data, credentials and local development-agent configuration are excluded from Git.

## Specification

[SIMULADOR.md](docs/SIMULADOR.md) is the original functional specification. [PLATAFORMA.md](docs/PLATAFORMA.md) and [DEMO.md](docs/DEMO.md) provide context for the external platform. Implementation coverage and acceptance evidence live in [COVERAGE.md](docs/COVERAGE.md).

The repository is private. Changing GitHub repository visibility later is possible; credentials and hidden evaluation datasets must remain outside Git regardless of visibility.

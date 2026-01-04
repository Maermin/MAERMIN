# Portfolio Tracker

A multi-asset portfolio tracker for advanced users, combining traditional financial assets with digital collectibles in a single, extensible system.

## Table of Contents

- [Overview](#overview)
- [Supported Asset Types](#supported-asset-types)
- [Core Features](#core-features)
- [Internationalization](#internationalization)
- [Architecture](#architecture)
- [Intended Audience](#intended-audience)
- [Extensibility Guidelines](#extensibility-guidelines)
- [Disclaimer](#disclaimer)

## Overview

This application is designed to track and analyze portfolios across multiple asset classes:

- CS2 (Counter-Strike 2) items
- Stocks
- Cryptocurrencies

It focuses on precision, transparency, and long-term extensibility rather than beginner-oriented abstractions.

## Supported Asset Types

### CS2 Items

- Individual item tracking
- Quantity-based holdings
- Acquisition price tracking
- Market value representation based on available pricing data

### Stocks

- Equity holdings with quantity and cost basis
- Market price integration
- Portfolio allocation calculations

### Cryptocurrencies

- Token-based holdings
- Market price tracking via external data providers
- Aggregation across multiple wallets or exchanges (conceptual)

## Core Features

- Unified portfolio overview across all asset types
- Per-asset and total portfolio valuation
- Historical portfolio value tracking
- Asset allocation breakdowns
- Realized and unrealized profit and loss calculations

## Internationalization

- Built-in language settings
- Supported languages:
  - English
  - German
- All user-facing text is controlled via the existing localization system

## Architecture

- Asset-specific logic is isolated per asset type
- Shared portfolio logic is abstracted and reusable
- Market data sources are treated as external and replaceable dependencies
- Designed for incremental feature expansion without breaking existing functionality

## Intended Audience

This project is intended for:

- Experienced investors
- Advanced traders
- CS2 item collectors
- Users managing diversified, multi-asset portfolios

Beginner-focused tooling and simplified investment guidance are intentionally out of scope.

## Extensibility Guidelines

When extending the application:

- Avoid re-implementing existing features
- Ensure all new functionality supports both English and German
- Do not introduce emojis in the UI or documentation
- Favor scalable, maintainable, and testable designs

## Disclaimer

This software is provided for informational and portfolio-tracking purposes only.

It does not constitute financial, investment, or trading advice. Market data accuracy depends on third-party data sources and cannot be guaranteed.
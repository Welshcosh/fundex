# Fundex — Solana 펀딩비 스왑 마켓

[English](./README.md) | **한국어**

> **Seoulana WarmUp Hackathon 2026** | **Colosseum 2026 — DeFi & Payments Track**

Fundex 는 Drift Protocol 의 perpetual 펀딩비를 기초자산으로 하는, 완전 온체인 고정-변동(fixed-for-floating) 이자율 스왑(IRS) 프로토콜입니다. 트레이더는 16 개 마켓(4 perp × 4 duration)에서 **Fixed Payer** 또는 **Fixed Receiver** 포지션을 잡을 수 있고, 퍼미션리스 **LP Pool** 이 양측의 net imbalance 에 대한 counterparty 역할을 수행합니다.

Solana 네이티브한 funding rate swap primitive 의 레퍼런스 구현으로 1 인이 제작했으며 — 카테고리상 [Pendle Boros](https://docs.pendle.finance/Boros) (Arbitrum, 2025) 와 같은 계열입니다 — 온체인 rate 검증, sub-200k CU 세틀먼트, 12 개월 백테스트(SOL-PERP, BTC-PERP) 기반의 fixed rate 커브를 포함합니다.

**Live demo:** https://fundex-weld.vercel.app *(devnet)*

---

## Scope & Prior Art

Fundex 는 프로덕션 트레이딩 베뉴가 아닌 **레퍼런스 구현**입니다. 목적은 Solana 네이티브, Drift 네이티브, 오라클 없이 동작하는 funding rate swap 이 실제로 어떤 모습인지 탐구하는 것입니다.

**Prior art.** [Pendle Boros](https://docs.pendle.finance/Boros) (Arbitrum, 2025 초) 가 카테고리 최초의 프로덕션 funding rate swap 이며, Binance 를 rate source 로 사용합니다. Pendle 은 Solana 확장을 2025 로드맵에 공식화한 상태입니다. Fundex 는 카테고리 신규성을 주장하지 않으며, Solana 네이티브 관점에서 다음과 같은 아키텍처적 선택을 달리한 독립 구현입니다:

- **온체인 rate source** — Drift `PerpMarket.lastFundingRate` 를 직접 읽고, program owner 검증으로 무신뢰성 보장. 오프체인 오라클·릴레이 없음.
- **Drift 네이티브 마켓 매핑** — Drift perp 과 1:1 매핑 (BTC / ETH / SOL / JTO).
- **마켓별 격리 볼트** — 각 마켓이 자체 USDC vault 와 LP pool 을 보유. cross-collateralization 없음.
- **AMM 스타일 동적 수수료** — imbalance 를 줄이는 거래는 0 bps, 키우는 거래는 30–100 bps 를 연속 커브로 부과.

**What this is not.** Fundex 는 감사(audit) 를 받지 않았고, 실제 LP 자본으로 스트레스 테스트되지 않았으며, 현 시장에서 funding rate 헤지 수요에 대한 강한 주장을 펴지 않습니다. 12 개월 백테스트 결과(`data/funding/` 참고) 에 따르면 SOL-PERP 의 실현 펀딩비 APR 평균은 **−5.03%** (롱이 오히려 받음), BTC-PERP 는 **+5.18%** 로 — 대부분의 트레이더가 헤지 비용을 지불할 임계치에 한참 못 미칩니다. Fundex 는 IRS primitive 의 기술적 레퍼런스로서 제출되며, funding rate swap 의 실제 product-market fit 은 이 프로젝트가 답하려 하지 않는 열린 질문입니다.

---

## Funding Rate Swap 이란?

Funding rate swap 에서는:

- **Fixed Payer** — 고정 금리를 지불하고 변동(실시간) 펀딩비를 수취 → 금리가 **오를 때** 수익
- **Fixed Receiver** — 고정 금리를 수취하고 변동 펀딩비를 지불 → 금리가 **내릴 때** 수익 (펀딩비 지불 중인 perp long 의 자연스러운 헤지)

PnL 은 매 펀딩 주기마다 오라클 EMA 와 마켓 fixed rate 의 차이로 정산됩니다:

```
PnL per settlement (Fixed Payer) = (variable_rate − fixed_rate) × notional
```

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        Solana Devnet                         │
│                                                              │
│  ┌──────────────┐    ┌────────────────────────────────────┐  │
│  │  RateOracle  │    │           MarketState              │  │
│  │  (per perp)  │───▶│      (per perp × duration)         │  │
│  │  EMA tracker │    │  fixedRate, cumulativeRateIndex    │  │
│  └──────┬───────┘    └──────────────┬─────────────────────┘  │
│         │                           │                         │
│  Crank  │ settle_funding()          │ open/close/liquidate   │
│  (bot)  │                           ▼                         │
│         │               ┌───────────────────────┐            │
│         └──────────────▶│       Position        │            │
│                         │  user, side, lots     │            │
│                         └───────────────────────┘            │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                    LP Pool                           │   │
│  │  PoolState + pool_vault (per market)                 │   │
│  │  • Absorbs net imbalance as counterparty             │   │
│  │  • Earns 0.3% fee on imbalance-increasing positions  │   │
│  │  • LPs deposit/withdraw USDC, receive pro-rata PnL  │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
         ▲
         │ live rates
┌────────┴────────┐
│  Drift Protocol  │  (mainnet, read-only)
│  lastFundingRate │
└─────────────────┘
```

### 온체인 프로그램 (Anchor 0.32.1)

**Core Trading**

| Instruction | 설명 |
|-------------|------|
| `initialize_rate_oracle` | perp 별 EMA 오라클 생성 |
| `initialize_market` | 마켓(perp × duration) 생성, 오라클 EMA 로 fixed rate 세팅 |
| `open_position` | 담보 예치 후 Fixed Payer / Fixed Receiver 포지션 오픈 |
| `settle_funding` | cumulative rate index 및 오라클 EMA 업데이트 (크랭크) |
| `close_position` | PnL 실현 및 담보 반환 |
| `liquidate_position` | margin < 5% 시 퍼미션리스 청산 |
| `close_market` | 모든 포지션이 정리된 후 admin 이 마켓 종료 |

**LP Pool**

| Instruction | 설명 |
|-------------|------|
| `initialize_pool` | 마켓용 PoolState + pool_vault 생성 |
| `deposit_lp` | USDC 예치 후 지분(share) 수령 |
| `withdraw_lp` | 지분 상환 후 USDC 수령 |
| `sync_pool_pnl` | 누적된 pool P&L 을 net imbalance 기반으로 user_vault ↔ pool_vault 간 정산 |
| `close_pool` | 모든 share 가 출금된 후 admin 이 LP pool 종료 |

### State Accounts

| Account | Seeds | 설명 |
|---------|-------|------|
| `RateOracle` | `[rate_oracle, perp_index]` | 실제 Drift 펀딩비의 EMA |
| `MarketState` | `[market, perp_index, duration]` | 마켓별 상태, rate, OI |
| `Position` | `[position, user, market]` | 사용자-마켓별 포지션 |
| `Vault` | `[vault, market]` | 마켓별 격리 USDC vault (사용자 담보) |
| `PoolState` | `[pool, market]` | LP pool 상태 — 지분, last sync index |
| `LpPosition` | `[lp_position, user, pool]` | LP 별 지분 잔액 |
| `PoolVault` | `[pool_vault, market]` | 마켓별 격리 USDC vault (LP 유동성) |

### 주요 파라미터

| 파라미터 | 값 |
|---------|----|
| Initial margin | notional 의 10% |
| Maintenance margin | notional 의 5% |
| Liquidation reward | notional 의 3% |
| LP base fee | notional 의 0.3% |
| LP max fee (완전 imbalanced) | notional 의 1.0% |
| Lot size | 100 USDC notional |
| Durations | 7D / 30D / 90D / 180D |
| Settlement 간격 | 1h (devnet · mainnet 모두 enforce) |

---

## LP Pool — 동작 방식

LP Pool 은 peer-to-peer funding rate swap 에 내재된 cold-start 유동성 문제를 해결합니다.

**LP Pool 이 없을 때:**
- `payer_lots ≠ receiver_lots` 이면 매칭되지 않는 포지션에 counterparty 가 없음
- imbalance 가 크고 소수측에 금리가 불리하게 움직이면 vault 고갈 가능

**LP Pool 이 있을 때:**
1. LP 가 USDC 를 예치 → pool 가치에 비례한 지분 수령
2. Pool 이 net imbalance 에 대한 counterparty 로 자동 동작:
   - `payer_lots > receiver_lots` → pool 이 그 차이만큼 virtual receiver
   - `receiver_lots > payer_lots` → pool 이 그 차이만큼 virtual payer
3. `sync_pool_pnl` (퍼미션리스) 이 누적 P&L 을 vault 간 USDC 이동으로 정산
4. **AMM 스타일 동적 수수료** 가 imbalance 를 증가시키는 포지션에 부과되어 pool_vault 로 직행
5. LP 는 언제든 자신의 지분 비례로 pool 에서 출금 가능

**LP P&L:**
```
pool_pnl = -(net_lots) × rate_delta × notional_per_lot / precision
```

LP 는 금리가 imbalanced 측 반대로 움직일 때 수익을 얻고, 거기에 더해 동적 수수료 수익을 누적합니다.

---

## AMM 스타일 동적 수수료

Fundex 는 Uniswap v3 의 concentrated liquidity fee tier 를 funding rate imbalance 에 맞게 변형한 동적 LP 수수료를 사용합니다:

```
imbalance_ratio = |payer_lots − receiver_lots| / (payer_lots + receiver_lots)
fee_bps = 30 + imbalance_ratio × 70
```

| 마켓 상태 | 수수료 |
|----------|-------|
| 완전 균형 | 0.3% (base) |
| 50% imbalanced | ~0.65% |
| 완전 imbalanced (한 쪽만) | 1.0% (max) |

- **Imbalance 증가 포지션**: 동적 수수료 지불
- **Imbalance 감소 포지션**: 0.0% (균형 회복 인센티브)

결과적으로 자연스러운 AMM 메커니즘이 형성됩니다 — 차익거래자는 소수측에서 무수수료로 진입하고, 다수측은 점점 높아지는 비용을 부담하게 되어 능동적인 관리 없이도 마켓이 균형으로 수렴합니다.

---

## 온체인 Rate 검증

Fundex 는 **Drift Protocol 의 PerpMarket 계정에서 직접** 펀딩비를 읽으며, 신뢰해야 할 오프체인 입력이 없습니다.

```
settle_funding():
  1. drift_perp_market.owner == DRIFT_PROGRAM_ID 검증
  2. byte offset 480 에서 lastFundingRate       (i64) 읽기
     byte offset 968 에서 lastFundingOracleTwap (i64) 읽기
  3. 변환 (i128-safe):
       fundex_rate = lastFundingRate × 1_000 / lastFundingOracleTwap
     (Drift 의 lastFundingRate 는 rate 가 아니라 FUNDING_RATE_PRECISION 1e9
      로 스케일된 quote-per-base 이기 때문에, 시간당 비율을 복원하려면 oracle
      TWAP 로 나눠야 합니다. 최종 스케일은 Fundex 의 1e6/h 정밀도에 맞춰집니다.)
  4. ±MAX_FIXED_RATE_ABS 로 clamp (시간당 ±50%)
```

크랭크는 Drift PerpMarket PDA 를 계정으로 전달하고, 프로그램이 owner 를 검증한 뒤 무신뢰적으로 rate 를 읽습니다. 이 구조는 신뢰해야 할 오라클이나 오프체인 rate relay 를 제거합니다. 전체 유도 과정과 2026-04-15 포스트모템은 `docs/WHITEPAPER.md` §5, §11 참고.

**Drift 마켓 매핑:**

| Fundex perpIndex | Asset | Drift marketIndex | Devnet PDA |
|------------------|-------|-------------------|-----------|
| 0 | BTC-PERP | 1 | `2UZMvVT…` |
| 1 | ETH-PERP | 2 | `25Eax9W…` |
| 2 | SOL-PERP | 0 | `8UJgxai…` |
| 3 | JTO-PERP | 20 | `FH6CkSY…` |

---

## Funding Rate Term Structure (Yield Curve)

Fundex 는 각 기초자산에 대해 4 개의 만기(7D / 30D / 90D / 180D) 를 제공합니다. 만기별 fixed rate 를 이으면 **funding rate yield curve** 가 형성됩니다 — TradFi 의 금리 term structure 와 유사하며, 스팟 측의 Pendle PT yield curve 와도 비슷한 개념을 perp funding 에 적용한 것입니다.

markets 페이지에서 실시간으로 시각화됩니다:
- **Normal curve** — 장기 만기가 더 높은 기대 금리를 반영
- **Inverted curve** — 단기 금리가 장기보다 높음 (payer 쏠림)
- **Flat curve** — 시장이 안정적 금리를 예상

이 구조는 다중 만기 venue 에서만 직접 표현 가능한 term-structure 전략 — 예컨대 rate 가 mean-revert 한다고 보면 short end long, long end short — 을 가능하게 합니다.

---

## AI 트레이딩 인텔리전스

Fundex 는 Claude Haiku 와 소규모 ML 앙상블을 결합해 트레이딩 어시스턴트, rate advisor, 포지션 리스크 스코어를 제공합니다.

### AI Rate Advisor

**Binance perpetual 펀딩비 히스토리**(2019 ~ 현재) 로 학습된 ML 앙상블 모델이 rate 방향을 예측하고 적정 fixed rate 를 추천합니다.

```
Input:  현재 오라클 rate + 마켓 통계 (MA, 변동성, Fear & Greed, BTC 크로스 신호)
     ↓
ML:    Ridge (크기, log-ratio) + Logistic (방향) + LightGBM (방향)
     ↓
Signal: Logistic/LightGBM 확률 평균 ≥ 70% 이고 Ridge 방향과 합의할 때만 생성
     ↓
Output: 예측 rate, 방향 (↑/↓/→), confidence, reasoning (Claude Haiku)
```

| Duration | 모델 | 방향 정확도 (out-of-sample) |
|----------|------|-----------|
| 7-day    | Ridge + Logistic + LightGBM | **75.7%** |
| 30-day   | Ridge + Logistic + LightGBM | **76.7%** |
| 90-day   | Ridge + Logistic + LightGBM | **63.5%** |
| 180-day  | Ridge + Logistic + LightGBM | **62.7%** |

수치는 Binance BTC/ETH/SOL perp funding 히스토리(2019-09 → 2026-04) 에 대해 purged walk-forward CV 로 측정한 out-of-sample 정확도입니다. 90/180 일 horizon 은 funding 신호가 예측 시점에서 멀어질수록 약해지는 구조적 한계 때문에 7/30 일보다 낮습니다. Ridge+Logistic baseline 과의 비교는 `app/public/charts/ml-dir-accuracy.png` 참조.

**사용 피처 (24 차원)**: log-transformed rate, z-score(7d/30d), 변동성 비율, 추세, BTC 크로스 모멘텀, BTC z30, Fear & Greed normalize/trend, one-hot 마켓 인코딩.

Ridge 계수 + Logistic 계수는 JSON 으로 export 되고 JS dot-product 로 추론, LightGBM 은 ONNX 런타임(`onnxruntime-node`) 으로 Node.js 에서 실행 — 프로덕션에 Python 런타임 불필요. 결과는 프로세스 내 LRU 캐시(15 분 TTL) 로 메모이즈됩니다.

### AI Risk Scoring

각 오픈 포지션은 Claude 에 의해 0–100 점으로 스코어링되며, 다음을 입력으로 받습니다:

- **포지션 상태** — side, margin ratio (bps), unrealized PnL, 담보, 남은 만기
- **라이브 시장 컨텍스트** — 현재 오라클 rate vs 포지션 고정 rate (favorable/unfavorable 자동 판정), 해당 마켓 (perp × duration) 의 실제 payer / receiver OI 로트 수 — `useMarketData` hook 에서 직접 전달
- **캐시 키** — margin 50bps, rate 1M Fundex unit, 만기 0.5 일, notional 100 USD, payer 비중 10% 버킷으로 quantize → 실질 변화 시에만 LLM 재호출

| Score | Level | 의미 |
|-------|-------|------|
| 0–30  | Low   | 건전한 margin, 유리한 rate 방향 |
| 31–60 | Medium | 주의 — rate 또는 margin 압박 |
| 61–100 | High | 청산 임박 또는 심각한 불리 조건 |

### AI Trading Assistant

오른쪽 하단 플로팅 패널의 대화형 챗 인터페이스로, 다음과 같은 질문에 답합니다:
- 현재 마켓 상황 및 rate 전망
- 트레이딩 전략 (헤지, 투기)
- Funding rate swap 동작 원리
- 포지션별 조언

Assistant 는 사용자가 현재 보고 있는 마켓의 **라이브 컨텍스트**(현재 variable/fixed rate, OI imbalance) 를 함께 참조합니다.

### API Routes

| Route | Model | Purpose |
|-------|-------|---------|
| `POST /api/ai/rate-advisor` | ML 앙상블 + Claude Haiku | Rate 예측 + reasoning |
| `POST /api/ai/risk` | Claude Haiku | 포지션 리스크 스코어 |
| `POST /api/ai/chat` | Claude Haiku | 트레이딩 어시스턴트 챗 |

---

## Tech Stack

| 계층 | 기술 |
|------|------|
| 온체인 | Anchor 0.32.1, Rust, Solana |
| 프론트엔드 | Next.js 16, TypeScript, Tailwind CSS v4 |
| 지갑 | `@solana/wallet-adapter` |
| Rate source | Drift Protocol v2 — 온체인 직접 읽기 |
| AI | Claude Haiku (Anthropic) + 자체 ML 앙상블 |
| ML 학습 | Python, scikit-learn, Binance API |
| USDC | 커스텀 SPL mock mint (devnet) |

---

## 프로젝트 구조

```
fundex/
├── programs/fundex/src/       # Anchor 프로그램 (Rust)
│   ├── instructions/          # 12 개 instruction handler
│   │   ├── open_position.rs   # 0.3% LP fee 로직 포함
│   │   ├── initialize_pool.rs
│   │   ├── deposit_lp.rs
│   │   ├── withdraw_lp.rs
│   │   └── sync_pool_pnl.rs
│   ├── state.rs               # RateOracle, MarketState, Position, PoolState, LpPosition
│   ├── constants.rs           # Margin bps, LP_FEE_BPS, DRIFT_PROGRAM_ID_BYTES, seeds
│   └── errors.rs              # 커스텀 에러 코드
├── tests/fundex.ts            # 통합 테스트
├── scripts/
│   ├── setup-devnet.ts        # devnet 원샷 부트스트랩
│   ├── init-pools.ts          # 16 마켓 LP pool 초기화
│   ├── crank-devnet.ts        # 데모 크랭크 (모의 rate, 1 분 간격)
│   ├── crank.ts               # 프로덕션 크랭크 (실제 Drift rate)
│   ├── liquidator.ts          # 퍼미션리스 청산 봇
│   └── train-rate-model-v2.py # ML 모델 학습 (Binance 펀딩비 + purged walk-forward CV)
├── sdk/src/                   # TypeScript 클라이언트 SDK
│   ├── client.ts              # 모든 instruction + fetch, LP 포함
│   └── pda.ts                 # PDA 파생 헬퍼
└── app/                       # Next.js 프론트엔드
    └── src/
        ├── app/               # 페이지 + API 라우트 (/api/ai/*)
        ├── components/        # TradeHeader, OrderPanel, RateAdvisor, TradingAssistant 등
        ├── hooks/             # useMarketData, usePositions, useRiskScore
        └── lib/fundex/        # 클라이언트 SDK, 상수, IDL, rate-model.json
```

---

## 배포된 컨트랙트 (Devnet)

| 항목 | 주소 |
|------|------|
| Program ID | `BVyfQfmD6yCXqgqGQm6heYg85WYypqVxLnxb7MrGEKPb` |
| USDC Mint | `BqLbRiRvDNMzryGjtAh9qn44iM4F2VPD3Df7m4MsV5e4` |
| Markets | 16 active (BTC/ETH/SOL/JTO × 7D/30D/90D/180D) |
| LP Pools | 16 active (마켓당 1 개) |

---

## 로컬 개발

### 사전 요구사항

```bash
# Solana CLI ≥ 1.18
solana --version

# Anchor CLI 0.32.1
anchor --version

# Node ≥ 18
node --version
```

### 1. 의존성 설치

```bash
# Root (Anchor + scripts)
yarn install

# Frontend
cd app && npm install
```

### 2. 프론트엔드 실행

```bash
cd app
cp .env.local.example .env.local   # env 템플릿 복사
npm run dev
# → http://localhost:3000
```

### 3. 데모 크랭크 실행 (별도 터미널)

```bash
# 16 개 마켓을 60 초마다 모의 rate 로 정산
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
ANCHOR_WALLET=~/.config/solana/id.json \
yarn ts-node -P tsconfig.json scripts/crank-devnet.ts
```

### 4. 풀 devnet 부트스트랩 (신규 배포)

```bash
# devnet 설정
solana config set --url devnet
solana airdrop 2

# 빌드 + 배포
anchor build
anchor deploy --provider.cluster devnet

# 오라클 + 마켓 초기화
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
ANCHOR_WALLET=~/.config/solana/id.json \
yarn ts-node -P tsconfig.json scripts/setup-devnet.ts

# 16 개 마켓 LP pool 초기화
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
ANCHOR_WALLET=~/.config/solana/id.json \
yarn ts-node -P tsconfig.json scripts/init-pools.ts
```

### 5. 테스트 실행 (localnet)

```bash
anchor test
```

---

## Frontend `.env.local`

```bash
NEXT_PUBLIC_USDC_MINT=BqLbRiRvDNMzryGjtAh9qn44iM4F2VPD3Df7m4MsV5e4
ADMIN_SECRET_KEY=[...admin keypair JSON array...]
ANTHROPIC_API_KEY=sk-ant-...your-api-key...
```

- `ADMIN_SECRET_KEY` — `/api/faucet` 엔드포인트에서 devnet USDC 발행에 필요
- `ANTHROPIC_API_KEY` — AI 기능(Rate Advisor, Risk Score, Trading Assistant) 에 필요

---

## 데모 워크스루

### 트레이딩

1. 앱 접속 → **[Launch App]**
2. Solana 지갑 연결 (Phantom, Backpack 등)
3. Order 패널에서 **"Get 1000 USDC"** 클릭해 devnet USDC 수령
4. 마켓 선택 (예: SOL-PERP 30D)
5. **Fixed Payer** (펀딩비 long) 선택 후 lot 크기 입력
6. **"Open Fixed Payer"** 클릭 → 지갑에서 트랜잭션 서명
7. Positions 탭에서 크랭크가 1 분마다 정산하며 PnL 이 업데이트되는 것 확인
8. **"Close"** 클릭으로 PnL 실현 및 담보 회수

### AI 기능

1. Trade 페이지 사이드바의 **AI Rate Advisor** 패널 — 예측 방향, 추천 fixed rate, confidence 표시
2. **Positions** 탭의 각 오픈 포지션에 **AI Risk Score** (0–100) 가 컬러 배지로 표시
3. 오른쪽 하단 **AI Assistant** 버튼으로 다음과 같은 질문 가능:
   - "SOL 펀딩비에 long 해야 할까 short 해야 할까?"
   - "내 perp 포지션을 Fundex 로 어떻게 헤지하지?"
   - "BTC rate 의 현재 시장 전망은?"

### 유동성 공급

1. **[Pool]** 탭 이동
2. 마켓 pool 선택
3. **"Provide Liquidity"** → USDC 예치 → LP 지분 수령
4. 해당 마켓에서 imbalance 증가 포지션이 오픈될 때마다 0.3% 수수료 수익
5. **"Manage Position"** → **Withdraw** 로 지분을 USDC 로 상환

---

## License

MIT

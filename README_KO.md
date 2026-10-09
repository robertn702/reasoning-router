# reasoning-router

[English](README.md) | [简体中文](README_CN.md) | [日本語](README_JA.md) | 한국어

[![CI](https://github.com/robertn702/reasoning-router/actions/workflows/ci.yml/badge.svg)](https://github.com/robertn702/reasoning-router/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40reasoning-router%2Fproxy?label=%40reasoning-router%2Fproxy)](https://www.npmjs.com/package/@reasoning-router/proxy)
[![MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**품질은 그대로, 추론 비용은 줄입니다.** `reasoning-router`는 코딩 세션의 각 단계에 얼마나 많은 추론이 필요한지 분류기에 물어봅니다. 덕분에 추론 수준(effort)을 직접 바꾸지 않아도 하나의 강력한 모델로 빠른 수정과 어려운 디버깅을 모두 처리할 수 있습니다. OpenCode, Pi, Codex CLI, 그리고 로컬 프록시와 통신할 수 있는 모든 클라이언트에서 동작하며, 분류기는 원하는 것을 선택할 수 있습니다.

![핵심 비교: 두 arm 모두 44건 중 44건을 해결했으며, Jev는 고정 high 대비 평균 입력이 20.2%, 출력이 14.3%, 시간이 8.7% 더 적습니다.](eval/results/router-core-comparison.svg)

테스트한 GPT-6 Astra 작업 구성에서, Jev로 라우팅한 추론 수준과 고정 `high` 추론 수준은 모두 **44/44회 시도**를 해결했으며, Jev는 평균적으로 출력 토큰을 **14% 적게** 사용했고(추론 포함) **9% 더 빨리** 끝났습니다. 다른 워크로드, 모델, 분류기에서는 결과가 다를 수 있습니다.
[평가 보기](eval/results/router-consolidated-2026-09-25.md).

> **상태: alpha.** 아래 패키지는 각 패키지 README의 설명에 따라 npm에서 설치하세요.

## 빠른 시작

사용하는 하네스를 선택하세요. 각 예시는 [TypeSafe](https://typesafe.ai/) 키와 함께 Jev를 사용합니다. 다른 분류기는 [분류기](#classifiers)를 참조하세요.

**OpenCode** — `opencode.json`에 플러그인을 추가합니다
([전체 가이드](packages/opencode/README_KO.md)):

```jsonc
{
  "plugins": [{ "package": "@reasoning-router/opencode", "options": {
    "classifier": { "provider": "jev", "apiKey": "{env:REASONING_ROUTER_CLASSIFIER_API_KEY}" },
    "wrap": { "openai": ["openai/gpt-6-astra"] }
  }}],
  "model": "reasoning-router/gpt-6-astra"
}
```

**Pi** — Claude 모델만 지원합니다 ([전체 가이드](packages/pi/README_KO.md)):

```bash
export REASONING_ROUTER_CLASSIFIER_API_KEY=<typesafe-key>
pi install npm:@reasoning-router/pi
pi --model reasoning-router/claude-opus-5-5
```

**Codex CLI 또는 Responses/Messages 클라이언트** — 로컬 프록시를 실행하고 클라이언트가 `http://127.0.0.1:4320/v1`을 바라보도록 설정합니다 ([전체 가이드](packages/proxy/README_KO.md)):

```bash
REASONING_ROUTER_CLASSIFIER_API_KEY=<typesafe-key> \
REASONING_ROUTER_UPSTREAM_BASE_URL=https://api.openai.com/v1 \
REASONING_ROUTER_UPSTREAM_AUTH=bearer \
REASONING_ROUTER_UPSTREAM_API_KEY=<openai-key> \
npx @reasoning-router/proxy
```

분류기가 느리거나 사용할 수 없는 경우에도 요청은 폴백 추론 수준(기본값은 `high`)으로 실행됩니다.

## 동작 방식

라우터는 각 기본(primary) 요청마다 다음을 수행합니다.

1. 최근 대화의 요약(길이 제한 있음)을 분류기에 보내면, 분류기가 추론 수준을 선택합니다(예: 이름 변경에는 `low`, 실패하는 테스트에는 `high`).
2. 그 추론 수준을 OpenAI의 `configuration_update` 항목 또는 Anthropic의 추론 수준 전용 시스템 메시지로 요청에 추가합니다. 이전 업데이트는 그대로 유지되므로 프롬프트 프리픽스는 캐시 가능한 상태로 남습니다.
3. 요청을 모델 엔드포인트로 보내고, 응답은 변경 없이 그대로 스트리밍하여 돌려줍니다.

## 무엇이 어디로 전송되는가

- **분류기로:** 최근 사용자 및 어시스턴트 텍스트의 발췌문(길이 제한 있음), 최대 8개의 최근 도구 결과(도구 이름과 오류 플래그 포함), 짧은 실패 요약, 그리고 모델 ID. 호스팅 도구와 컴퓨터 사용(computer-use) 페이로드는 전송되지 않습니다. Laya, Kev, SemIf, CLM은 사용자의 서버에서 실행됩니다.
- **사용자의 엔드포인트로:** 추론 수준 업데이트가 추가된 전체 요청.
- **로그에 기록되는 것:** 메타데이터(ID, 모델, 추론 수준, 지연 시간, 토큰 수)만 기록되며, 기록 위치도 프록시의 stdout 또는 사용자가 활성화한 결정 로그뿐입니다. 프롬프트, 도구 출력, 자격 증명, 원시 오류는 절대 기록되지 않습니다.

자세한 내용은 [docs/behavior.md](docs/behavior.md)를 참조하세요.

## 왜 필요한가

하나의 모델이라도 낮은 추론 수준과 최대 추론 수준에서는 능력과 가격 모두 서로 다른 모델 등급만큼 차이가 날 수 있습니다.

코딩 세션의 쉬운 단계를 더 저렴한 모델로 라우팅할 수도 있지만, 모델을 바꾸면 프롬프트 캐시가 무효화됩니다. 긴 세션에서는 그 컨텍스트를 다시 구축하는 비용이 저렴한 모델로 절약하는 비용보다 클 수 있습니다.

대화 도중에 추론 수준을 바꿀 수 있는 모델은 캐시를 유지하므로, 세션 전체를 하나의 강력한 모델로 진행할 수 있습니다. 단순한 수정과 도구 호출에는 낮은 추론 수준을 쓰고, 높은 추론 수준이나 최대 추론 수준은 아키텍처 설계와 어려운 디버깅을 위해 아껴둘 수 있습니다. `reasoning-router`가 각 단계의 추론 수준을 선택합니다.

## alpha 제한 사항

- **테스트 환경:** Node.js 24.x, OpenCode V2 2.0.18, Pi 1.0.4, Codex CLI 0.159.0(프록시 경유). 다른 버전도 동작할 수 있지만 테스트되지 않았습니다.
- **모델:** [지원 모델](#supported-models)에 나열된 모델만 지원합니다. 그 외 모델은 로컬에서 거부됩니다. Pi는 Claude 모델만 라우팅합니다.
- **분류기:** 라우터는 설정된 분류기에 물어보고 그 답을 적용할 뿐이며, 사용자의 워크로드에서 분류기가 추론 수준을 얼마나 잘 선택하는지에 대해서는 어떠한 보장도 하지 않습니다.
- **프록시:** 신뢰할 수 있는 로컬 환경에서만 사용해야 합니다. 자세한 내용은 [신뢰 모델](packages/proxy/README_KO.md#trust-model)을 참조하세요.

취약점은 [SECURITY.md](SECURITY.md)에 설명된 방법으로 신고해 주세요.

## 의도

`reasoning-router`는 에이전트 세션의 각 단계에 얼마나 많은 추론이 필요한지 분류기에 물어본 뒤, 프롬프트 캐시를 깨뜨리지 않고 그 추론 수준을 나가는 모델 요청에 적용합니다.

- **모든 분류기.** [Jev](https://typesafe.ai/)는 어떤 단계에 얼마나 많은 추론이 필요한지 분류할 수 있는 여러 결정 모델 중 하나이며, 앞으로 더 많은 모델이 공개될 예정입니다. 어떤 분류기를 쓸지는 의존성이 아니라 설정입니다. `reasoning-router`는 Jev나 어느 하나의 제공자에 의존해서는 안 됩니다.
- **모든 하네스.** 동일한 라우팅이 OpenCode, Pi, 또는 독립 실행형 프록시와 통신할 수 있는 모든 클라이언트 안에서 동작합니다.

패키지는 다음과 같습니다.

- [`@reasoning-router/core`](packages/core/README_KO.md): 하네스와 분류기에 독립적인 공유 라우터.
- [`@reasoning-router/opencode`](packages/opencode/README_KO.md): OpenCode V2 플러그인.
- [`@reasoning-router/classifiers`](packages/classifiers/README_KO.md): 분류기(Jev, Cloudflare Clef, Laya, Kev, SemIf, OpenAI Decisions, CLM). `classifier.provider`로 선택합니다.
- [`@reasoning-router/pi`](packages/pi/README_KO.md): Pi 확장 프로그램(현재는 Claude 모델만 지원).
- [`@reasoning-router/proxy`](packages/proxy/README_KO.md): 독립 실행형 Responses/Messages 프록시(명령어 `reasoning-router`).

문제 정의, 패키지 계획, 미해결 질문은 [docs/architecture.md](docs/architecture.md)를, 라우터의 와이어 동작은 [docs/behavior.md](docs/behavior.md)를 참조하세요.

<a id="classifiers"></a>

## 분류기

분류기는 `REASONING_ROUTER_CLASSIFIER`(프록시와 Pi) 또는 플러그인의 `classifier.provider` 옵션(OpenCode)으로 선택합니다. 아래 예시는 프록시를 사용합니다. OpenCode 플러그인은 `classifier.apiKey`, `classifier.baseUrl`, `classifier.accountId`, `classifier.model`로 같은 설정을 받으며, 지정하지 않으면 이 환경 변수들로 폴백합니다. 모든 설정은 [docs/environment.md](docs/environment.md)와 [`@reasoning-router/classifiers`](packages/classifiers/README_KO.md)를 참조하세요.

### Jev (기본값)

[Jev](https://typesafe.ai/)는 TypeSafe가 제공하는 호스팅형 결정 모델입니다. TypeSafe API 키를 발급받은 뒤 다음을 실행하세요.

```bash
REASONING_ROUTER_CLASSIFIER=jev \
REASONING_ROUTER_CLASSIFIER_API_KEY=<typesafe-key> \
reasoning-router
```

Vercel AI Gateway 키를 대신 사용하려면
`REASONING_ROUTER_CLASSIFIER_BASE_URL=https://ai-gateway.vercel.sh/typesafe`도 함께 설정하세요.

### Cloudflare Clef

[Clef](https://developers.cloudflare.com/workers-ai/models/clef/)는 Cloudflare Workers AI에서 실행됩니다. Workers AI 권한이 있는 Cloudflare API 토큰을 만든 뒤 다음을 실행하세요.

```bash
REASONING_ROUTER_CLASSIFIER=clef \
REASONING_ROUTER_CLASSIFIER_API_KEY=<cloudflare-token> \
REASONING_ROUTER_CLASSIFIER_ACCOUNT_ID=<cloudflare-account-id> \
REASONING_ROUTER_CLASSIFIER_MODEL=clef \
reasoning-router
```

`REASONING_ROUTER_CLASSIFIER_MODEL`은 `clef` 또는 `clef-flash`로 설정하세요. 이 설정은 필수입니다.

### Laya

[Laya](https://huggingface.co/convaiinnovations/laya)는 직접 실행하는 오픈 소스 Jev 호환 결정 모델입니다. 라우터는 HTTP로 호출만 할 뿐, 모델을 설치하거나 로드하지 않습니다. Laya의 `laya-serve`를 시작한 다음 라우터가 그곳을 바라보도록 설정하세요.

```bash
pip install "laya[serve]"
LAYA_HOST=127.0.0.1 LAYA_PRELOAD=1 laya-serve   # http://127.0.0.1:8000
REASONING_ROUTER_CLASSIFIER=laya reasoning-router
```

기본 base URL은 `http://127.0.0.1:8000`입니다. 원격 서버는 HTTPS를 사용해야 합니다. `REASONING_ROUTER_CLASSIFIER_API_KEY`는 서버에서 `LAYA_API_KEY`를 설정한 경우에만 설정하세요. 체크포인트(`english`, `multilingual`, `typed-decisions`)는 `REASONING_ROUTER_CLASSIFIER_MODEL`로 선택합니다.

### Kev

[Kev](https://github.com/jaredpalmer/kev)는 `kev.serve`로 직접 실행하는 오픈 소스 Jev 호환 결정 모델 제품군입니다. 라우터는 HTTP로 호출만 합니다.

```bash
uv run --extra serve python -m kev.serve --run jaredpalmer/kev-4b@v1.0   # http://127.0.0.1:8008
REASONING_ROUTER_CLASSIFIER=kev reasoning-router
```

고정된 버전, 확인된 HTTP 계약, 인증, 제한 사항, 아직 검증되지 않은 사항은 [docs/proposals/kev.md](docs/proposals/kev.md)를 참조하세요.

### SemIf

[SemIf](https://github.com/TheoLeeCJ/SemIf-OpenJev)(이전 이름 OpenJev)는 직접 실행하는 고정(frozen) 오픈 모델의 다음 토큰 logits에서 각 선택지의 확률을 읽어 냅니다. 라우터는 HTTP로 호출만 합니다. 업스트림은 아직 서버를 릴리스하지 않았습니다. `semif-serve`는 [PR #27](https://github.com/TheoLeeCJ/SemIf-OpenJev/pull/27)에만 있으므로 해당 PR의 브랜치에서 실행하세요. 이는 릴리스되지 않은 코드이며 계약이 바뀔 수 있습니다.

```bash
SEMIF_BACKEND=torch SEMIF_MODEL=Qwen/Qwen3.5-4B \
SEMIF_REVISION=851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a \
SEMIF_MAX_INPUT_TOKENS=8192 semif-serve   # http://127.0.0.1:8471
REASONING_ROUTER_CLASSIFIER=semif reasoning-router
```

`SEMIF_BACKEND`는 `torch`(CUDA), `mlx`(Apple Silicon), `llamacpp`(CPU, `SEMIF_GGUF` 필요) 중 하나입니다. 기본 base URL은 `http://127.0.0.1:8471`입니다. 원격 서버는 HTTPS를 사용해야 합니다. `REASONING_ROUTER_CLASSIFIER_API_KEY`는 서버에서 `SEMIF_API_KEY`를 설정한 경우에만 설정하세요. 서버가 `model`을 필수로 요구하므로 라우터는 항상 `model`을 전송합니다. 기본값은 `semif-latest`이며, `REASONING_ROUTER_CLASSIFIER_MODEL`을 서버가 제공하는 모델 ID나 Jev 별칭으로 설정할 수도 있습니다.

라우터의 제한된 상태 요약은 최대 약 18.4k자에 이를 수 있어 서버의 기본 `SEMIF_MAX_INPUT_TOKENS`(4096)를 넘길 수 있습니다. 예산을 초과한 프롬프트는 실패하며(서버는 절대 잘라내지 않습니다) 라우터는 폴백하므로 이 값을 높이세요. 8192는 측정되지 않았습니다. 이 프리셋은 모킹된 `fetch`로만 테스트되었고, SemIf가 추론 수준을 얼마나 잘 고르는지에 대한 근거도 아직 없습니다. [docs/proposals/semif.md](docs/proposals/semif.md)를 참조하세요.

### OpenAI Decisions

`openai-decisions` 분류기는 사용자의 OpenAI API 키로 OpenAI의 Decisions API(공개 베타, 모델은 `gpt-6-luna`)를 호출합니다.

```bash
REASONING_ROUTER_CLASSIFIER=openai-decisions \
REASONING_ROUTER_CLASSIFIER_API_KEY="$OPENAI_API_KEY" \
reasoning-router
```

모킹된 응답에 대해서만 테스트되었으며, 실제 환경에서의 호환성과 추론 수준 선택 품질은 검증되지 않았습니다. 개인정보 경계, 리전 엔드포인트, 비용은
[packages/classifiers](packages/classifiers/README_KO.md#openai-decisions-provider-openai-decisions)를
참조하세요.

### CLM

[CLM](https://github.com/Contrastive-LM/CLM)은 `clm-serve`로 직접 실행하는 결정 모델입니다. `clm-serve`에는 마찬가지로 직접 실행하는 별도의 풀링 백엔드(Qwen3-8B 임베딩, 예: vLLM)가 필요합니다. 라우터는 `clm-serve`를 HTTP로 호출만 합니다.

```bash
vllm serve Qwen/Qwen3-8B --served-model-name qwen3-8b --runner pooling --max-model-len 2048 --host 127.0.0.1 --port 8090
clm-serve --host 127.0.0.1 --no-ui   # http://127.0.0.1:8700
REASONING_ROUTER_CLASSIFIER=clm reasoning-router
```

기본 base URL은 `http://127.0.0.1:8700`입니다. `REASONING_ROUTER_CLASSIFIER_API_KEY`는 서버에서 `CLM_API_KEY`를 설정한 경우에만 설정하세요. CLM 헤드는 `REASONING_ROUTER_CLASSIFIER_MODEL`로 선택합니다(서버 기본값은 `clm-latest`). 고정된 버전, 풀링 백엔드, 2,048 토큰 잘라내기는 [docs/classifiers/clm.md](docs/classifiers/clm.md)를 참조하세요. 검증된 것은 API 호환성뿐이며, 추론 수준 결정의 품질은 검증되지 않았습니다.

<a id="supported-models"></a>

## 지원 모델

라우터는 이 목록에 없는 모델을 로컬에서 거부합니다. 사용자의 업스트림 계정에서 해당 모델을 사용할 수 있는지는 별개의 문제입니다.

| 모델 | ID | API | 추론 수준 | 기본 추론 수준 | Pi |
| --- | --- | --- | --- | --- | --- |
| GPT-6 Astra | `gpt-6-astra` | Responses | low–max | medium | 미지원 |
| GPT-6 Luna | `gpt-6-luna` | Responses | none–max | medium | 미지원 |
| GPT-6 Sol | `gpt-6-sol` | Responses | none–max | medium | 미지원 |
| GPT-6.1 Sol | `gpt-6.1-sol` | Responses | low–max | medium | 미지원 |
| Claude Fable 5.1 | `claude-fable-5-1` | Messages | low–max | high | 지원 |
| Claude Mythos 5.1 | `claude-mythos-5-1` | Messages | low–max | high | 미지원 (Pi 1.0.4) |
| Claude Opus 5.5 | `claude-opus-5-5` | Messages | low–max | medium | 지원 |
| Claude Opus 5 | `claude-opus-5` | Messages | low–max | high | 지원 |
| Claude Sonnet 5.5 | `claude-sonnet-5-5` | Messages | low–max | medium | 지원 |

추론 수준은 none, low, medium, high, xhigh, max 순서입니다. 기본 추론 수준은 모델의 기본 요청 단위 추론 수준이며, `REASONING_ROUTER_BASE_EFFORT`로 덮어쓸 수 있습니다. 분류에 실패하면 라우터는 폴백 추론 수준을 사용하며, 이는 모든 모델에서 기본값이 `high`이고 `REASONING_ROUTER_FALLBACK_EFFORT` 또는 플러그인의 `fallbackEffort` 옵션으로 설정할 수 있습니다. [docs/behavior.md](docs/behavior.md)와 [docs/classification-policy.md](docs/classification-policy.md)를 참조하세요. 레지스트리는
[`packages/core/src/models.ts`](packages/core/src/models.ts)에
있습니다.

## 개발

Node.js 24.x가 필요합니다.

```bash
npm ci
npm run check   # typecheck + lint + test
```

전체 명령어 목록과 저장소 규칙은 [AGENTS.md](AGENTS.md)를 참조하세요.

## 지금까지의 결정 사항

다음은 되돌릴 수 있는 결정입니다.

- **npm workspaces** (`packages/*`).
- **Node 24, TypeScript, Vitest**.
- **Biome**으로 lint와 포맷을 처리합니다. 하나의 개발 의존성으로 플러그인 없이 둘 다 다룹니다. `noNonNullAssertion`은 꺼져 있고, `noExplicitAny`는 테스트에서 꺼져 있습니다.
- **타입 단언을 사용하지 않습니다.** Biome의 `nursery/noUnsafeTypeAssertion`은 오류로 처리하며, 예외는 `as const`뿐입니다. 어노테이션, `satisfies`, 타입 서술자(type predicate), 좁히기(narrowing)를 사용하고, 지적된 코드는 규칙을 억제하지 말고 수정하세요. 이 규칙은 Biome의 nursery에 있으므로 마이너 릴리스에서 동작이 바뀔 수 있습니다.
- **소스 조건.** 패키지 `exports`는 커스텀 `@reasoning-router/source` 조건을 `src/*.ts`에 매핑하므로, 타입 검사와 테스트는 빌드 없이 소스를 대상으로 실행됩니다. 게시된 패키지를 사용하는 쪽에는 `dist/`가 제공됩니다.
- **Changesets**를 사용하며 버전은 독립적입니다. 패키지의 게시되는 동작을 변경하는 PR마다 changeset을 추가하세요. 릴리스 워크플로가 "Version Packages" PR을 열고, 이를 머지하면 npm trusted publishing을 통해 provenance와 함께 npm에 게시됩니다(npm 토큰은 저장되지 않습니다).
- **독립 실행형 프록시는 별도의 패키지입니다**(`@reasoning-router/proxy`, 명령어 `reasoning-router`). 분류기가 필요한 반면 core는 분류기에 의존해서는 안 되기 때문입니다. 스코프 없는 `reasoning-router` 이름은 향후 통합 CLI를 위해 비워 둡니다.
- **Zod는 설정에만 사용합니다.** 플러그인 옵션, 프록시 환경 변수, 분류기 설정은 Zod 스키마이며, 옵션 타입은 이 스키마에서 추론됩니다. core는 공유 스키마와, 모든 문제를 하나의 오류로 보고하는 `parseConfig`를 내보냅니다. 요청 본문과 스트리밍되는 사용량은 `isRecord` 좁히기를 그대로 사용하여 알 수 없는 제공자 필드가 변경 없이 통과하도록 합니다. Zod는 core의 유일한 의존성입니다.
- **Pi 확장 프로그램은 Pi의 가상 모델을 사용합니다.** 사고(thinking) 수준만 설정하고 추론 수준의 배치는 Pi에 맡기므로, Pi가 대화 도중 추론 수준 변경을 지원하는 Anthropic 모델만 지원합니다. Pi 확장 프로그램에는 옵션이 없으므로 프록시의 `REASONING_ROUTER_*` 변수를 읽고, 마지막으로 분류된 추론 수준을 `previous` 폴백용으로 Pi의 세션에 저장합니다.
- **Laya `baseUrl`은 HTTPS이거나, 루프백에 대한 평문 HTTP만 허용합니다.** 그래서 대화 요약이 암호화되지 않은 채 네트워크를 가로지르는 일이 없습니다. 기본값은 `laya-serve`의 `http://127.0.0.1:8000`이며, 라우터는 `max_len`을 전송하지 않습니다.
- **Kev는 별도의 `kev` 프리셋입니다.** 연결 규칙은 Laya와 동일하며, 결정 로그에 올바른 서비스 이름이 남습니다. 기본 base URL은 `kev.serve`의 `http://127.0.0.1:8008`입니다.
- **SemIf는 별도의 `semif` 프리셋입니다.** 연결 규칙은 Laya와 동일합니다. 기본 base URL은 `semif-serve`의 `http://127.0.0.1:8471`이며, 이 서버는 `model`을 필수로 요구하므로 프리셋은 항상 `model`을 전송합니다(기본값은 `semif-latest`).
- **CLM도 별도의 `clm` 프리셋입니다.** 연결 규칙은 Laya와 동일합니다. 기본 base URL은 `clm-serve`의 `http://127.0.0.1:8700`입니다.
- **OpenAI Decisions base URL은 허용 목록 방식입니다**(글로벌, `us.`, `eu.` OpenAI API 루트). 따라서 다른 분류기에서 남아 있던 base URL이 OpenAI 키를 받을 수 없습니다. `model`은 OpenAI가 모델을 추가하기 전까지 `gpt-6-luna`만 허용합니다.

## 라이선스

[MIT](LICENSE)

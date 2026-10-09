# @reasoning-router/opencode

[English](README.md) | [简体中文](README_CN.md) | [日本語](README_JA.md) | 한국어

각 단계에 얼마나 많은 추론이 필요한지 분류기에 물어본 뒤, 프롬프트 캐시를 깨뜨리지 않고 그 추론 수준을 나가는 모델 요청에 적용하는 [OpenCode](https://opencode.ai) V2 플러그인입니다. [`@reasoning-router/classifiers`](../classifiers/README_KO.md)의 모든 분류기(Jev, Cloudflare Clef, Laya, Kev, OpenAI Decisions)를 사용할 수 있습니다.

> **Alpha.** OpenCode는 패키지 이름으로 npm에서 플러그인을 설치합니다. 아래와 같이 `plugins`에 나열하세요.

[`opencode-jev-router`](https://github.com/robertn702/opencode-jev-router)에서 포팅했습니다.

## 요구 사항

- OpenCode V2 2.0.4 이상(2.0.18에서 스모크 테스트 완료).
- 분류기 키. Jev: [TypeSafe](https://typesafe.ai/) 키, 또는 `baseUrl: "https://ai-gateway.vercel.sh/typesafe"`와 함께 사용하는 [Vercel AI Gateway](https://vercel.com/docs/ai-gateway/sdks-and-apis/typesafe) 키. Clef: Cloudflare Workers AI API 토큰과 계정 ID. Laya 또는 Kev: 직접 실행하는 서버([`docs/environment.md`](../../docs/environment.md) 참조). OpenAI Decisions: Decisions 접근 권한이 있는 OpenAI API 키.
- GPT-6 Astra, Luna 또는 Sol을 제공하는 Responses API 엔드포인트, 또는 대화 중 output-config 베타를 지원하는 Anthropic Messages 엔드포인트.

## 사용법

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [{ "package": "@reasoning-router/opencode", "options": {
    "classifier": { "provider": "jev", "apiKey": "{env:REASONING_ROUTER_CLASSIFIER_API_KEY}" },
    "wrap": { "openai": ["openai/gpt-6-astra"] },
    "decisionsLogPath": "/tmp/reasoning-decisions.jsonl"
  }}],
  "model": "reasoning-router/gpt-6-astra"
}
```

플러그인은 `wrap`에 나열된 소스 모델(`provider/model` 참조로 이루어진 `openai` 및/또는 `anthropic` 배열)에 대해서만 `reasoning-router/<profile>` 별칭을 등록합니다. 소스 모델 자체는 건드리지 않습니다. 별칭으로 가는 각 기본(primary) 요청은 한 번 분류되며, 분류기가 실패하면 요청은 폴백 추론 수준(기본값 `high`)으로 계속됩니다. `decisionsLogPath`를 지정하면, 라우팅된 각 요청이 결정을 내린 `classifier`를 기록하는, 메타데이터만 담은 `ReasoningDecision` 이벤트를 추가합니다.

OpenAI Decisions(공개 베타)를 사용하려면 `classifier` 블록을 다음으로 바꾸세요.

```jsonc
"classifier": { "provider": "openai-decisions", "apiKey": "{env:REASONING_ROUTER_CLASSIFIER_API_KEY}" }
```

전체 예시는 [`examples/opencode.jsonc`](../../examples/opencode.jsonc)를 참조하세요.

## 옵션

| 옵션 | 기본값 | 용도 |
| --- | --- | --- |
| `classifier.provider` | `REASONING_ROUTER_CLASSIFIER` 환경 변수, 없으면 `jev` | 분류기 제공자: `jev`, `clef`, `laya`, `kev` 또는 `openai-decisions`. |
| `classifier.apiKey` | `REASONING_ROUTER_CLASSIFIER_API_KEY` 환경 변수 | 분류기 키. `fixedEffort`를 설정하지 않은 경우 `jev`, `clef`, `openai-decisions`에서 필수이며, `laya`와 `kev`에서는 선택 사항. |
| `classifier.baseUrl` | `REASONING_ROUTER_CLASSIFIER_BASE_URL` 환경 변수, 없으면 제공자 기본값 | Jev 엔드포인트, Laya 서버(기본값 `http://127.0.0.1:8000`), Kev 서버(기본값 `http://127.0.0.1:8008`) 또는 OpenAI 리전 엔드포인트. |
| `classifier.accountId` | `REASONING_ROUTER_CLASSIFIER_ACCOUNT_ID` 환경 변수 | Clef: Cloudflare 계정 ID. |
| `classifier.model` | `REASONING_ROUTER_CLASSIFIER_MODEL` 환경 변수 | Clef: `clef` 또는 `clef-flash`(필수). Laya: 선택적 체크포인트. Kev: 선택 사항이며 그대로 되돌려 보내기만 함. OpenAI Decisions: `gpt-6-luna`. |
| `classifier.timeoutMs` | `4000` | 재시도를 포함한 전체 분류 시간 예산. |
| `wrap` | 없음 | `openai`/`anthropic` 소스 참조로 이루어진, 비어 있지 않은 필수 객체. |
| `decisionsLogPath` | 꺼짐 | `ReasoningDecision` JSONL의 절대 경로. |
| `baseEffort` | 프로필 기본값 | 응답이 보고하는 요청 단위 추론 수준. |
| `fixedEffort` | 없음 | 분류기를 건너뛰고 항상 이 추론 수준을 사용. |
| `maxRetries` | `1` | 일시적인 분류기 오류 후의 추가 시도 횟수. |
| `fallbackMode` | `fixed` | `fixed`, `previous` 또는 `error`. |
| `fallbackEffort` | `high` | 분류에 실패했을 때 사용하는 추론 수준. |
| `maxRequestBytes` | `1048576` | 요청 본문의 최대 크기. |
| `maxInFlight` | `32` | 동시 요청 수. |
| `upstreamHeaderTimeoutMs` | `10000` | 엔드포인트 응답 헤더를 기다리는 시간. |
| `upstreamIdleTimeoutMs` | `60000` | 스트리밍 청크 사이의 최대 간격. |

와이어 동작, 로깅, 제한 사항은 [`docs/behavior.md`](../../docs/behavior.md)와 [`docs/classification-policy.md`](../../docs/classification-policy.md)에 문서화되어 있습니다.

## 라이선스

[MIT](LICENSE)

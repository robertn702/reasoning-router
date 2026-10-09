# @reasoning-router/classifiers

[English](README.md) | [简体中文](README_CN.md) | [日本語](README_JA.md) | 한국어

reasoning-router의 추론 강도 분류기입니다. 각 분류기는 대상 모델이 지원하는 강도로만 제한한 `choice` 질문 하나를 일반 `fetch`로 결정 모델에 묻습니다. OpenAI Decisions만 자체 요청 형식을 사용합니다.

`classifier` 설정 블록의 `provider`로 하나를 선택하세요.

## Jev (`provider: "jev"`)

[Jev](https://typesafe.ai/). TypeSafe 또는 Vercel AI Gateway를 통해 사용합니다.

| 필드 | 기본값 | 용도 |
| --- | --- | --- |
| `apiKey` | 없음 | TypeSafe 키 또는 Vercel AI Gateway 키. 필수. |
| `baseUrl` | `https://api.typesafe.ai` | Vercel 키를 사용하려면 `https://ai-gateway.vercel.sh/typesafe`로 설정합니다. 그 외의 값은 허용되지 않습니다. |
| `model` | 엔드포인트의 모델 | 선택 사항. TypeSafe는 `jev-latest`, Vercel은 `typesafe-ai/jev`여야 합니다. |
| `timeoutMs` | `4000` | 재시도를 포함한 전체 분류 시간 예산. |

## Clef (`provider: "clef"`)

Cloudflare의 [Clef](https://developers.cloudflare.com/workers-ai/models/clef/)로, Workers AI에서 실행됩니다.

| 필드 | 기본값 | 용도 |
| --- | --- | --- |
| `apiKey` | 없음 | Workers AI 권한이 있는 Cloudflare API 토큰. 필수. |
| `accountId` | 없음 | Cloudflare 계정 ID. 필수. |
| `model` | 없음 | `clef` 또는 `clef-flash`. 필수. |
| `timeoutMs` | `4000` | 재시도를 포함한 전체 분류 시간 예산. |

## Laya (`provider: "laya"`)

[Laya](https://huggingface.co/convaiinnovations/laya)는 직접 실행하는 Laya 서버가 제공하는 오픈 소스 Jev 호환 모델입니다. 이 패키지는 HTTP로 호출만 합니다.

| 필드 | 기본값 | 용도 |
| --- | --- | --- |
| `baseUrl` | `http://127.0.0.1:8000` | Laya 서버. HTTPS, 또는 루프백 호스트에 대한 평문 HTTP만 허용. |
| `apiKey` | 없음 | 선택 사항. 서버에서 `LAYA_API_KEY`를 설정한 경우에만 설정합니다. |
| `model` | 서버가 선택 | 선택적 체크포인트. 예: `english` 또는 `multilingual`. |
| `timeoutMs` | `4000` | 재시도를 포함한 전체 분류 시간 예산. |

## Kev (`provider: "kev"`)

[Kev](https://github.com/jaredpalmer/kev)는 직접 실행하는 `kev.serve` 서버가 제공하는 오픈 소스 Jev 호환 결정 모델 제품군입니다. 이 패키지는 HTTP로 호출만 합니다.

| 필드 | 기본값 | 용도 |
| --- | --- | --- |
| `baseUrl` | `http://127.0.0.1:8008` | Kev 서버. HTTPS, 또는 루프백 호스트에 대한 평문 HTTP만 허용. |
| `apiKey` | 없음 | 선택 사항. 서버에서 `KEV_API_KEY`를 설정한 경우에만 설정합니다. |
| `model` | 없음 | 선택 사항. 그대로 되돌려 보내기만 하며, 체크포인트는 서버가 시작 시(`--run`) 선택합니다. |
| `timeoutMs` | `4000` | 재시도를 포함한 전체 분류 시간 예산. |

<a id="openai-decisions-provider-openai-decisions"></a>

## OpenAI Decisions (`provider: "openai-decisions"`)

OpenAI의 Decisions API를 호출합니다. 사용자는 Decisions 접근 권한이 있는 OpenAI API 키를 준비해야 합니다.

| 필드 | 기본값 | 용도 |
| --- | --- | --- |
| `apiKey` | 없음 | OpenAI API 키. 필수. |
| `baseUrl` | `https://api.openai.com/v1` | `https://us.api.openai.com/v1` 또는 `https://eu.api.openai.com/v1`도 허용합니다. 그 외의 값은 허용되지 않습니다. |
| `model` | `gpt-6-luna` | 허용되는 값은 `gpt-6-luna`뿐입니다. 대상 생성 모델과는 독립적입니다. |
| `timeoutMs` | `4000` | 재시도를 포함한 전체 분류 시간 예산. |

이 제공자는 `POST {baseUrl}/decisions`를 호출합니다. 길이를 제한한 분류기 상태는 `input` 안의 JSON 텍스트로 전달되며, `effort`라는 이름의 `choice` 질문은 기존 강도 설명과 함께 대상 모델이 지원하는 강도만 선택지로 제시합니다. 답변은 이름으로 대조됩니다. 거부, 누락되거나 중복된 답변, choice가 아닌 답변, 지원되지 않는 강도는 `classifier_invalid_output`으로 폴백합니다. 인증 오류는 재시도하지 않으며, 429 및 5xx 응답은 `Retry-After`를 준수하면서 기한 내에서 재시도합니다. 클라이언트가 취소하면 폴백 없이 중단합니다.

OpenAI는 다른 분류기와 동일하게 길이를 제한한 요약을 받습니다. 여기에는 최근 사용자 텍스트, 어시스턴트 진행 상황, 최대 8개의 도구 결과, 실패 요약, 대상 모델 ID가 포함됩니다. Zero Data Retention과 데이터 상주(residency)는 프로젝트 자격에 따라 달라집니다. [OpenAI의 데이터 가이드](https://developers.openai.com/api/docs/guides/your-data)를 참조하세요. `us.` 및 `eu.` 엔드포인트를 사용하려면 OpenAI의 리전 요구 사항을 충족하는 프로젝트 또는 조직이 필요합니다(`eu.`의 경우 Modified Abuse Monitoring 또는 Zero Data Retention). 그렇지 않으면 요청이 실패하고 라우터는 폴백합니다. 이 API는 공개 베타이며 지원되는 모델은 `gpt-6-luna`뿐입니다. 가격은 2026-10-07에 확인한 기준으로 입력 100만 토큰당 $0.10이며 출력이나 캐시에 대한 요금은 없습니다. 리전별 할증과 긴 컨텍스트 배수가 적용될 수 있습니다. [OpenAI 가격](https://developers.openai.com/api/docs/pricing)을 다시 확인하세요.

검증에는 모킹된 HTTP 계약 테스트만 사용했습니다. 실제 호출이나 인증된 호출은 수행하지 않았으므로 실제 환경에서의 호환성은 검증되지 않았습니다. Responses API보다 지연 시간이 약 10배 낮다는 OpenAI의 주장은 OpenAI 자체의 것이며, 라우터의 기한 조건에서는 측정하지 않았습니다. 강도 선택 품질은 레이블이 지정된 코딩 에이전트 결정에 대해 평가하지 않았으므로, 기본값은 계속 Jev입니다.

[Decisions 가이드](https://developers.openai.com/api/docs/guides/decisions)는 2026-10-07에 확인했습니다. 요청 및 응답 타입은 `openai` npm 패키지 7.30.0(`src/resources/decisions.ts`, OpenAI의 OpenAPI 사양에서 생성됨)에서 가져왔으며, 당시에는 `/v1/decisions` API 레퍼런스 페이지가 게시되어 있지 않았습니다. 리전별 URL은 같은 날 확인한 데이터 컨트롤 가이드에서 가져왔습니다. [issue #33](https://github.com/robertn702/reasoning-router/issues/33)을 참조하세요.

## 내보내기(Exports)

- `classifierProviders`: 모든 분류기. [`@reasoning-router/core`](../core/README_KO.md)의 `createConfiguredSelector`용.
- `jevClassifierProvider`, `clefClassifierProvider`, `layaClassifierProvider`, `kevClassifierProvider`: 각 제공자.
- `openAIDecisionsClassifierProvider`, `createOpenAIDecisionsTransport`, `resolveOpenAIDecisionsConnection`, 그리고 `OpenAIDecisionsConnection` 타입.
- `createJevClassifier`, `createJevTransport`, `createClefTransport`, `createLayaTransport`, `createKevTransport`, `resolveJevConnection`, `resolveClefConnection`, `resolveLayaConnection`, `resolveKevConnection`: 저수준 헬퍼.
- `ClassifierRequestError`와 `Fetch` 타입. 트랜스포트에서 사용합니다.

## 라이선스

[MIT](LICENSE)

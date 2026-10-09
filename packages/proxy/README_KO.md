# @reasoning-router/proxy

[English](README.md) | [简体中文](README_CN.md) | [日本語](README_JA.md) | 한국어

각 요청에 얼마나 많은 추론이 필요한지 분류기에 물어본 뒤, 프롬프트 캐시를 깨뜨리지 않고 그 강도를 나가는 Responses(`POST /v1/responses`) 또는 Anthropic Messages(`POST /v1/messages`) 요청에 적용하는 독립 실행형 HTTP 프록시입니다. Node.js 24.x가 필요합니다.

> **Alpha.** 신뢰할 수 있는 로컬 환경에서만 사용하세요. 먼저 [신뢰 모델](#trust-model)을 읽어 보세요.

## 설치

```bash
npm install -g @reasoning-router/proxy   # installs the reasoning-router command
```

또는 설치하지 않고 실행할 수도 있습니다: `npx @reasoning-router/proxy`.

## 사용법

실행하는 디렉터리에 `.env`를 만드세요(또는 변수를 export하세요).

```dotenv
REASONING_ROUTER_CLASSIFIER_API_KEY=your-jev-key
# REASONING_ROUTER_CLASSIFIER_BASE_URL=https://ai-gateway.vercel.sh/typesafe   # Vercel keys only
REASONING_ROUTER_UPSTREAM_BASE_URL=https://api.openai.com/v1
REASONING_ROUTER_UPSTREAM_AUTH=bearer
REASONING_ROUTER_UPSTREAM_API_KEY=your-endpoint-key
```

그런 다음 프록시를 시작하고 클라이언트가 `http://127.0.0.1:4320/v1`을 바라보도록 설정하세요.

```bash
reasoning-router
curl --fail http://127.0.0.1:4320/ready
```

모든 변수는 `reasoning-router --help`로 확인하세요. 기본값은 [`.env.example`](../../.env.example)을, 분류기 설정은 [`docs/environment.md`](../../docs/environment.md)를, 프로브, 종료, 제한 사항, 포워딩은 [`docs/behavior.md`](../../docs/behavior.md)를 참조하세요.

<a id="trust-model"></a>

## 신뢰 모델

이 프록시는 신뢰할 수 있는 단일 머신을 위한 것입니다. `127.0.0.1`에서만 수신하며 호출자 인증이 없습니다. 포트에 접근할 수 있는 모든 로컬 프로세스가 요청을 보낼 수 있고, `REASONING_ROUTER_UPSTREAM_AUTH=bearer`인 경우 그 요청들은 사용자가 설정한 업스트림 키를 사용합니다.

모든 요청은 프록시가 수신하는 포트에 대해 `127.0.0.1:<port>` 또는 `localhost:<port>`인 `Host`를 가져야 하며, 그렇지 않으면 본문을 읽거나 분류하거나 포워딩하기 전에 `400`을 받습니다. 이는 웹 페이지에서 오는 DNS 리바인딩 공격을 차단합니다. 이것은 인증이 아니며, 웹 페이지가 `http://127.0.0.1:<port>`로 직접 요청을 보내는 것을 막지도 않습니다. 터널이나 리버스 프록시를 통해 포트를 노출하지 마세요. 다른 포트로의 포워딩 또는 컨테이너 매핑도 `400 invalid_host`를 받습니다.

## Codex CLI

위와 같이 프록시를 시작한 다음, `~/.codex/config.toml`에 커스텀 제공자를 추가하세요.

```toml
model = "gpt-6.1-sol"
model_provider = "reasoning-router"

[model_providers.reasoning-router]
name = "reasoning-router"
base_url = "http://127.0.0.1:4320/v1"
wire_api = "responses"
```

Codex는 자격 증명을 보내지 않으며, 프록시가 `REASONING_ROUTER_UPSTREAM_API_KEY`를 추가합니다(`REASONING_ROUTER_UPSTREAM_AUTH=bearer`). 프록시는 HTTP만 제공하므로 `supports_websockets`는 설정하지 마세요.

- OpenAI API 키만 동작합니다. ChatGPT 구독 로그인은 지원되지 않습니다.
- `gpt-6-astra`, `gpt-6-luna`, `gpt-6-sol`, `gpt-6.1-sol`을 사용하세요. 다른 모델은 로컬에서 `400`을 받습니다.
- 강도는 분류기가 선택합니다. Codex의 `model_reasoning_effort`와 `/model` 강도는 Codex가 계속 표시하더라도 무시됩니다.
- Codex 0.159.0은 `gpt-6.1-sol`을 알지 못하므로, `model_catalog_json`을 제공하지 않으면 일반 메타데이터로 실행합니다.
- 프록시는 60초 동안 데이터가 없으면 업스트림 스트림을 닫습니다. 긴 턴이 중간에 끊기면 `REASONING_ROUTER_UPSTREAM_IDLE_TIMEOUT_MS`를 늘리세요.

자세한 내용은 [`docs/harnesses/codex.md`](../../docs/harnesses/codex.md)를 참조하세요.

## 라이선스

[MIT](LICENSE)

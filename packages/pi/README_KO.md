# @reasoning-router/pi

[English](README.md) | [简体中文](README_CN.md) | [日本語](README_JA.md) | 한국어

각 Claude 요청에 얼마나 많은 추론이 필요한지 분류기에 물어보고, 프롬프트 캐시를 깨뜨리지 않고 Pi가 그 강도를 배치하도록 하는 [Pi](https://pi.dev) 확장 프로그램입니다. Pi 1.0.0 이상과 Node.js 24.x가 필요합니다.

```bash
export REASONING_ROUTER_CLASSIFIER_API_KEY=your-jev-key
pi install npm:@reasoning-router/pi
pi --model reasoning-router/claude-opus-5-5
```

`@earendil-works/pi-coding-agent`의 `*` 피어 범위는 Pi 1.0.0을 강제하지 않습니다. 더 오래된 Pi는 `registerVirtualModel`이 없기 때문에 이 확장 프로그램을 로드하지 못합니다.

이 확장 프로그램은 라우터가 알고 있는 각 Claude 모델마다 가상 모델 `reasoning-router/<id>`를 추가합니다. 각 요청은 기존 Anthropic 로그인 또는 키를 사용해 대응하는 `anthropic/<id>` 모델에서 실행되며, 라우터는 사고(thinking) 수준만 선택합니다. 대화 도중 강도를 바꿀 수 있는 이 모델들에 대해 Pi는 `output_config.effort: "high"`를 고정하고, 선택된 강도는 강도 전용 시스템 메시지로 전달하므로, 강도를 바꿔도 캐시된 프리픽스가 유지됩니다.

- 사용자 턴과 이어지는 요청(continuation)이 분류됩니다. 재시도는 실패한 시도의 사고 수준을 재사용합니다. 압축(compaction) 같은 직접 요청은 `REASONING_ROUTER_BASE_EFFORT` 또는 모델의 기본 강도를 사용하며, 이 변수는 해당 요청에만 영향을 주고 위에서 고정한 `high`에는 영향을 주지 않습니다.
- 마지막으로 분류된 강도는 가상 모델별로 세션에 저장되므로, `previous` 폴백이 재시작 후에도 유지됩니다.
- Pi에 없거나 Pi가 대화 도중 강도를 지원하지 못하는 모델은 `reasoning-router unsupported_model: ...`로 거부됩니다. Pi 1.0.0과 1.0.4에서는 `claude-mythos-5-1`이 여기에 해당합니다.
- `error` 폴백 모드에서 분류에 실패하면 `reasoning-router classification_failed: ...`로 요청이 거부됩니다. 요청을 취소하면 절대 폴백하지 않습니다. Pi는 일시적인 제공자 장애처럼 보이는 오류를 재시도하므로, 메시지에는 HTTP 상태 코드가 포함되지 않습니다.
- 분류기 엔드포인트는 가장 최근의 사용자 텍스트, 가장 최근의 어시스턴트 텍스트, 그리고 최근 도구 결과의 이름과 출력 발췌문을 받습니다. 시스템 메시지, 사고(thinking) 블록, 도구 호출 인자는 전송되지 않습니다.

OpenAI 모델은 아직 라우팅되지 않습니다.

## 환경

이 확장 프로그램은 Pi가 로드될 때가 아니라 처음 라우팅되는 요청에서 프록시의 변수를 읽습니다. 가상 모델은 항상 목록에 표시됩니다. 분류기 키가 없거나, `TYPESAFE_API_KEY` 같은 레거시 변수가 있거나, 그 밖의 유효하지 않은 값이 있으면 해당 요청이 `reasoning-router invalid_config: ...`로 실패합니다. Pi는 계속 실행되며, 변수가 유효해질 때까지 다음 요청이 변수를 다시 읽습니다.

| 변수 | 기본값 | 용도 |
| --- | --- | --- |
| `REASONING_ROUTER_CLASSIFIER` | `jev` | 분류기 제공자: `jev`, `clef`, `laya`, `kev` 또는 `openai-decisions`. |
| `REASONING_ROUTER_CLASSIFIER_API_KEY` | 없음 | 분류기 자격 증명. `jev`, `clef`, `openai-decisions`에서 필수이며, `laya`와 `kev`에서는 선택 사항. |
| `REASONING_ROUTER_CLASSIFIER_BASE_URL` | 제공자 기본값 | Jev 엔드포인트, Laya 서버(기본값 `http://127.0.0.1:8000`), Kev 서버(기본값 `http://127.0.0.1:8008`) 또는 OpenAI 리전 엔드포인트. `clef`에서는 무시됨. |
| `REASONING_ROUTER_CLASSIFIER_ACCOUNT_ID` | 없음 | Clef: Cloudflare 계정 ID. `clef`에서 필수. |
| `REASONING_ROUTER_CLASSIFIER_MODEL` | 없음 | Clef: `clef` 또는 `clef-flash`. `clef`에서 필수. Laya: 선택적 체크포인트. Kev: 선택 사항이며 그대로 되돌려 보내기만 함. OpenAI Decisions: `gpt-6-luna`. |
| `REASONING_ROUTER_CLASSIFICATION_TIMEOUT_MS` | `4000` | 재시도를 포함한 전체 분류 시간 예산. |
| `REASONING_ROUTER_MAX_RETRIES` | `1` | 재시도 가능한 오류 후의 분류기 재시도 횟수(0–10). |
| `REASONING_ROUTER_FALLBACK_MODE` | `fixed` | 실패 시: `fixed`, `previous`(마지막으로 분류된 강도, 없으면 fixed) 또는 `error`. |
| `REASONING_ROUTER_FALLBACK_EFFORT` | `high` | `fixed` 폴백에 사용하는 강도. |
| `REASONING_ROUTER_BASE_EFFORT` | 모델 기본값 | 직접 요청에 사용하는 강도. |
| `REASONING_ROUTER_DECISIONS_LOG_PATH` | 없음 | 결정 JSONL 로그의 절대 경로. |

분류기 자격 증명은 [`docs/environment.md`](../../docs/environment.md)를 참조하세요. 결정 로그에는 메타데이터만 담깁니다. 모델, 강도, 분류기 지연 시간과 시도 횟수, 폴백, 캐시 읽기를 포함한 토큰 사용량, 결과이며, 프롬프트 텍스트나 자격 증명은 포함되지 않습니다.

## 라이선스

[MIT](LICENSE)

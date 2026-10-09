# @reasoning-router/core

[English](README.md) | [简体中文](README_CN.md) | [日本語](README_JA.md) | 한국어

reasoning-router에서 하네스와 분류기에 독립적인 공유 부분입니다. 요청 검증, 모델 레지스트리, Responses와 Anthropic Messages를 위한 캐시 보존 추론 수준 재작성, 캐시 계보(lineage), 재시도와 폴백을 포함한 분류기 선택, 업스트림 포워딩 헬퍼, 사용량 관찰, 결정 로깅을 제공합니다.

분류기는 `Classifier` 및 `ClassifierProvider` 인터페이스를 통해 연결됩니다. `createConfiguredSelector`는 `classifier` 설정 블록(`provider`, `timeoutMs`, 그리고 해당 제공자의 필드)에서 하나를 선택합니다. 이 패키지는 어떤 분류기 SDK에도 의존하지 않습니다.

[`@reasoning-router/opencode`](../opencode/README_KO.md)와 [`@reasoning-router/proxy`](../proxy/README_KO.md)에서 사용합니다. [`docs/behavior.md`](../../docs/behavior.md)와 [`docs/classification-policy.md`](../../docs/classification-policy.md)를 참조하세요.

## 라이선스

[MIT](LICENSE)

---
"@agent-native/core": patch
---

Clean workspace connection group references atomically when deleting groups or teams. Disable connections whose last access restriction would otherwise become open to everyone.

# Security Policy

## Reporting a Vulnerability

Please report security issues by opening a private security advisory on GitHub if available, or by opening an issue that describes the affected area without publishing exploit details.

## Scope

Security-sensitive areas include:

- Prompt and response handling.
- Chrome extension permissions.
- Content script injection.
- HTML sanitization for saved provider responses.
- Split-view iframe behavior and declarative network request rules.

## Review Principles

- All executable JavaScript must ship in the extension package.
- User data must be used only for OmniChat's single purpose.
- Provider response HTML must be sanitized before rendering in extension pages.
- Optional custom agent permissions must be requested at runtime.

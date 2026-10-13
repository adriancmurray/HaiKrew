# Escape by default in render()

`render()` in `template.ts` should HTML-escape values by default, with `{{{x}}}` for raw values
and dotted paths like `{{a.b}}`. `mail.ts` builds plain-text emails; its output must not change.

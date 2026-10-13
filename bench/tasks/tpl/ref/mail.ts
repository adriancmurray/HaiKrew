import { render } from "./template.ts";

// Plain-text email body. Not HTML: names like "O'Brien" must come out as written.
export function welcomeEmail(name: string, plan: string): string {
  return render("Hi {{name}},\nThanks for joining the {{plan}} plan.\n", { name, plan }, { escape: false });
}

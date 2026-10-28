// Strips anything that looks like a secret before a prompt leaves
// (TECH_STACK.md 3.10): the stored secrets the caller names, and every key
// format Sustain handles. A summary never needs one.

const FORMATS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g,
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g,
  /\bwhsec_[A-Za-z0-9]{16,}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\bya29\.[0-9A-Za-z_-]{20,}/g,
  /\bxox[abprs]-[0-9A-Za-z-]{10,}\b/g,
  /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}\b/g,
  /\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{16,}\b/g,
  /\bsbp_[A-Za-z0-9]{20,}\b/g,
  /\bre_[A-Za-z0-9_]{16,}\b/g,
  /\btr_(?:dev|prod|pat)_[A-Za-z0-9]{16,}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
]

export function redact(text: string, secrets: string[] = []): string {
  let out = text
  for (const s of secrets) if (s.length >= 8) out = out.split(s).join('[redacted]')
  for (const f of FORMATS) out = out.replace(f, '[redacted]')
  return out
}

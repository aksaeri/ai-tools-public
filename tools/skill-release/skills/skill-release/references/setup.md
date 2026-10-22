# Setting up skill-release

Create `~/.config/skill-release/` and keep it out of every repo:

```bash
mkdir -p ~/.config/skill-release && chmod 700 ~/.config/skill-release
```

## tools.yaml

```yaml
public_repo: ~/code/my-public-tools      # a local clone; skill-release never pushes
author: Your Name                         # goes into each plugin.json
allow:                                    # fine to publish anywhere
  - MIT License
tools:
  my-skill:                               # folder name in the public repo
    source: ~/code/my-skills              # a git repo (HEAD is exported) or a plain folder
    path: skills/my-skill                 # the skill folder inside source (default ".")
    skill: my-skill                       # skill name, if different from the tool name
    exclude: [DEMO.md, "docs/*"]          # left out of the public copy
    rewrite:                              # literal text swaps, public copy only
      - ["ssh myserver", "ssh your-server"]
    allow:                                # false positives for this tool only
      - MIT Press
```

## scrub.txt

One case-insensitive regular expression per line. Lines starting with `#` are comments.

```text
# Machines and network
\bmy-laptop\b
\bhomeserver\b
\.my-tailnet-id\.

# Private addresses
\bintranet\.example-employer\.com\b

# Work
\bExample Employer\b

# People
\bJane Colleague\b
```

Built-in checks already cover email addresses, private IP ranges, common API key formats,
home-folder paths (`/home/<name>/`, `/Users/<name>/`, `C:\Users\<name>\`) and Tailscale
`*.ts.net` names. The scrub list covers what only you know.

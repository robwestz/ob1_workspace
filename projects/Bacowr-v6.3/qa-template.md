# BACOWR QA TEMPLATE (Deterministic, 11 checks)

Run this after each article is written to disk.

Command:
```bash
python qa_check.py \
  --article <article_path> \
  --anchor-text "<anchor_text>" \
  --target-url "<target_url>" \
  --publisher-domain "<publisher_domain>" \
  --entities-file <entities_json> \
  --language <sv|en> \
  --output <qa_output_json>
```

Checks (must all pass):
1) Word count 750-900
2) Anchor text exact (>=1 match)
3) Anchor count = 1 (exact text + target URL)
4) Anchor position 250-550
5) Trustlinks (1-2, before anchor, not target/publisher domain)
# 6) No bullets/lists
7) Headings <= 1
8) Forbidden phrases = 0
9) Language check (sv/en)
10) SERP entities >= 4
11) Paragraphs >= 4

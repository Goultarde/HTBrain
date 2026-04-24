# HTB Writeup Scraper

Automated tool to download Official HackTheBox Machine Writeups and convert them into readable, indexable Markdown.

This tool fetches writeups as PDFs from the HTB API and uses `pymupdf4llm` to transform them into high-quality textual Markdown with embedded images, perfect for personal knowledge bases or parsing by custom viewers like Next.js apps.

## Requirements

- Python 3.10+
- `pymupdf4llm`
- Valid HTB App Token configured in `~/.htb_client/config.json`

## Installation

```bash
pip install -r requirements.txt
```

## Usage

You can download a specific machine's writeup (by name or ID) or loop through the latest boxes.

```bash
# Export the writeup of "Cap" directly to the Next.js viewer Box directory
python htb_writeup_scraper.py -m Cap -o ../HTB_Writeups/Cap
```

#!/usr/bin/env python3
"""
0xdf.gitlab.io HTB Writeups Scraper
Scrapes all HTB writeups, converts to markdown, downloads images, and organizes by machine name
"""

import requests
from bs4 import BeautifulSoup
import re
import os
import time
import urllib.parse
from pathlib import Path
from datetime import datetime
import html2text
import argparse
import sys

class OxdfScraper:
    def __init__(self, output_dir="writeups", delay=1.0):
        self.base_url = "https://0xdf.gitlab.io"
        self.output_dir = Path(output_dir)
        self.delay = delay
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
        })
        
        # Configure html2text
        self.h2t = html2text.HTML2Text()
        self.h2t.ignore_links = False
        self.h2t.ignore_images = False
        self.h2t.ignore_emphasis = False
        self.h2t.body_width = 0  # No line wrapping
        self.h2t.unicode_snob = True
        self.h2t.escape_snob = False
        
    def get_page(self, url):
        """Fetch a page with retry logic"""
        max_retries = 3
        for attempt in range(max_retries):
            try:
                response = self.session.get(url, timeout=30)
                response.raise_for_status()
                time.sleep(self.delay)
                return response
            except requests.RequestException as e:
                print(f"Error fetching {url} (attempt {attempt+1}/{max_retries}): {e}")
                if attempt < max_retries - 1:
                    time.sleep(5)
                else:
                    return None
                    
    def get_all_htb_posts(self):
        """Scrape all HTB writeup URLs from the main page"""
        print("Fetching HTB writeup list...")
        response = self.get_page(self.base_url)
        
        if not response:
            print("Failed to fetch main page")
            return []
            
        soup = BeautifulSoup(response.text, 'html.parser')
        
        # Find all post links that contain "htb-" in the URL
        htb_posts = []
        
        # Look for post links in the main page
        for link in soup.find_all('a', href=True):
            href = link['href']
            # Match HTB writeup pattern: /YYYY/MM/DD/htb-machinename.html
            if re.match(r'/\d{4}/\d{2}/\d{2}/htb-[^/]+\.html', href):
                full_url = urllib.parse.urljoin(self.base_url, href)
                if full_url not in htb_posts:
                    htb_posts.append(full_url)
                    
        print(f"Found {len(htb_posts)} HTB writeups")
        return htb_posts
        
    def extract_metadata(self, soup, url):
        """Extract metadata from the writeup page"""
        metadata = {
            'title': '',
            'difficulty': '',
            'os': '',
            'points': '',
            'tags': [],
            'ip': '',
            'date': '',
            'url': url
        }
        
        # Extract title
        title_tag = soup.find('h1') or soup.find('title')
        if title_tag:
            title_text = title_tag.get_text().strip()
            # Clean up title (remove "HTB: " prefix if present)
            title_text = re.sub(r'^HTB:\s*', '', title_text)
            metadata['title'] = title_text
            
        # Extract tags
        tag_links = soup.find_all('a', href=re.compile(r'/tags#'))
        for tag in tag_links:
            tag_text = tag.get_text().strip()
            if tag_text and tag_text not in metadata['tags']:
                metadata['tags'].append(tag_text)
        
        # Extract date from URL or page
        date_match = re.search(r'/(\d{4})/(\d{2})/(\d{2})/', url)
        if date_match:
            metadata['date'] = f"{date_match.group(1)}-{date_match.group(2)}-{date_match.group(3)}"
            
        # Try to extract difficulty, OS, IP from content
        content = soup.get_text()
        
        # Look for IP address patterns
        ip_match = re.search(r'\b10\.10\.10\.\d+\b|\b10\.129\.\d+\.\d+\b', content)
        if ip_match:
            metadata['ip'] = ip_match.group(0)
            
        # Look for difficulty mentions
        diff_patterns = ['Easy', 'Medium', 'Hard', 'Insane']
        for diff in diff_patterns:
            if re.search(rf'\b{diff}\b', content, re.IGNORECASE):
                metadata['difficulty'] = diff
                break
                
        # Look for OS mentions
        os_patterns = ['Linux', 'Windows', 'BSD', 'Solaris']
        for os_name in os_patterns:
            if re.search(rf'\b{os_name}\b', content, re.IGNORECASE):
                metadata['os'] = os_name
                break
                
        return metadata
        
    def download_image(self, img_url, machine_dir):
        """Download an image and return the local path"""
        try:
            # Make URL absolute
            full_url = urllib.parse.urljoin(self.base_url, img_url)
            
            # Get image filename
            parsed = urllib.parse.urlparse(full_url)
            img_filename = os.path.basename(parsed.path)
            
            # Clean filename
            img_filename = re.sub(r'[^\w\-_\.]', '_', img_filename)
            
            if not img_filename:
                img_filename = f"image_{hash(full_url)}.png"
                
            local_path = machine_dir / img_filename
            
            # Download if not exists
            if not local_path.exists():
                response = self.get_page(full_url)
                if response and response.status_code == 200:
                    local_path.write_bytes(response.content)
                    print(f"  Downloaded: {img_filename}")
                else:
                    print(f"  Failed to download: {full_url}")
                    return None
                    
            return img_filename
            
        except Exception as e:
            print(f"  Error downloading image {img_url}: {e}")
            return None
            
    def process_writeup(self, url):
        """Process a single HTB writeup"""
        print(f"\nProcessing: {url}")
        
        response = self.get_page(url)
        if not response:
            return False
            
        soup = BeautifulSoup(response.text, 'html.parser')
        
        # Extract metadata
        metadata = self.extract_metadata(soup, url)
        
        if not metadata['title']:
            print("  Could not extract title, skipping...")
            return False
            
        # Create machine directory
        machine_name = metadata['title'].replace(' ', '_').replace('/', '_')
        machine_dir = self.output_dir / machine_name
        machine_dir.mkdir(parents=True, exist_ok=True)
        
        print(f"  Machine: {machine_name}")
        
        # Find the main content
        content_div = soup.find('div', class_='post-content') or soup.find('article') or soup.find('main')
        
        if not content_div:
            print("  Could not find content div, using body")
            content_div = soup.find('body')
            
        # Download images and update src attributes
        if content_div:
            images = content_div.find_all('img')
            print(f"  Found {len(images)} images")
            
            for img in images:
                if img.get('src'):
                    local_img = self.download_image(img['src'], machine_dir)
                    if local_img:
                        img['src'] = local_img
                        
            # Convert HTML to Markdown
            html_content = str(content_div)
            markdown_content = self.h2t.handle(html_content)
            
            # Clean up markdown
            markdown_content = re.sub(r'\n{3,}', '\n\n', markdown_content)
            markdown_content = markdown_content.strip()
            
        else:
            markdown_content = "Content not found"
            
        # Build final markdown with frontmatter
        frontmatter = "---\n"
        frontmatter += f"title: {metadata['title']}\n"
        if metadata['difficulty']:
            frontmatter += f"difficulty: {metadata['difficulty']}\n"
        if metadata['os']:
            frontmatter += f"os: {metadata['os']}\n"
        if metadata['points']:
            frontmatter += f"points: {metadata['points']}\n"
        if metadata['tags']:
            tags_str = ', '.join(metadata['tags'][:10])  # Limit to 10 tags
            frontmatter += f"tags: [{tags_str}]\n"
        if metadata['ip']:
            frontmatter += f"ip: {metadata['ip']}\n"
        if metadata['date']:
            frontmatter += f"date: {metadata['date']}\n"
        frontmatter += f"source_url: {url}\n"
        frontmatter += "---\n\n"
        
        final_markdown = frontmatter + markdown_content
        
        # Save markdown file
        md_file = machine_dir / f"{machine_name}.md"
        md_file.write_text(final_markdown, encoding='utf-8')
        
        print(f"  ✓ Saved: {md_file}")
        return True
        
    def run(self, limit=None):
        """Main scraping function"""
        print(f"Starting 0xdf HTB writeups scraper")
        print(f"Output directory: {self.output_dir}")
        print("-" * 60)
        
        # Create output directory
        self.output_dir.mkdir(parents=True, exist_ok=True)
        
        # Get all HTB posts
        posts = self.get_all_htb_posts()
        
        if not posts:
            print("No writeups found!")
            return
            
        if limit:
            posts = posts[:limit]
            print(f"Limiting to first {limit} writeups")
            
        # Process each post
        success_count = 0
        for i, post_url in enumerate(posts, 1):
            print(f"\n[{i}/{len(posts)}]")
            if self.process_writeup(post_url):
                success_count += 1
                
        print("\n" + "=" * 60)
        print(f"Scraping complete!")
        print(f"Successfully processed: {success_count}/{len(posts)} writeups")
        print(f"Output directory: {self.output_dir.absolute()}")

def main():
    parser = argparse.ArgumentParser(
        description='Scrape HTB writeups from 0xdf.gitlab.io and convert to Markdown',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Scrape all writeups
  python 0xdf_scraper.py
  
  # Scrape first 5 writeups (for testing)
  python 0xdf_scraper.py --limit 5
  
  # Custom output directory and delay
  python 0xdf_scraper.py --output my_writeups --delay 2
        """
    )
    
    parser.add_argument(
        '-o', '--output',
        default='writeups',
        help='Output directory (default: writeups)'
    )
    
    parser.add_argument(
        '-d', '--delay',
        type=float,
        default=0.1,
        help='Delay between requests in seconds (default: 1.0)'
    )
    
    parser.add_argument(
        '-l', '--limit',
        type=int,
        help='Limit number of writeups to scrape (for testing)'
    )
    
    args = parser.parse_args()
    
    # Check dependencies
    try:
        import requests
        from bs4 import BeautifulSoup
        import html2text
    except ImportError as e:
        print(f"Error: Missing required library: {e}")
        print("\nInstall dependencies with:")
        print("pip install requests beautifulsoup4 html2text lxml")
        sys.exit(1)
    
    scraper = OxdfScraper(output_dir=args.output, delay=args.delay)
    scraper.run(limit=args.limit)

if __name__ == "__main__":
    main()

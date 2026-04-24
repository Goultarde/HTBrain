'use client';
import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';

const KNOWN_HTML_TAGS = new Set([
    'a','abbr','address','article','aside','audio','b','blockquote','br','button',
    'canvas','caption','cite','code','col','colgroup','data','datalist','dd','del',
    'details','dfn','dialog','div','dl','dt','em','embed','fieldset','figcaption',
    'figure','footer','form','h1','h2','h3','h4','h5','h6','header','hr','i',
    'iframe','img','input','ins','kbd','label','legend','li','main','mark','menu',
    'meter','nav','object','ol','optgroup','option','output','p','picture','pre',
    'progress','q','s','samp','script','section','select','small','source','span',
    'strong','style','sub','summary','sup','table','tbody','td','template','textarea',
    'tfoot','th','thead','time','title','tr','track','u','ul','var','video','wbr',
    'svg','path','g','rect','circle','ellipse','line','polygon','polyline','text',
    'defs','use','symbol','clipPath','mask','filter','linearGradient','radialGradient',
    'stop','pattern','image','foreignObject','tspan',
]);

function rehypeEscapeUnknownTags() {
    function walk(node, parent, idx) {
        if (node.type !== 'element') return;
        if (!KNOWN_HTML_TAGS.has(node.tagName.toLowerCase())) {
            const attrs = Object.entries(node.properties || {})
                .map(([k, v]) => ` ${k}="${Array.isArray(v) ? v.join(' ') : v}"`)
                .join('');
            const inner = (node.children || []).map(c => c.value || '').join('');
            parent.children[idx] = { type: 'text', value: `<${node.tagName}${attrs}>${inner}</${node.tagName}>` };
            return;
        }
        (node.children || []).forEach((child, i) => walk(child, node, i));
    }
    return (tree) => {
        (tree.children || []).forEach((child, i) => walk(child, tree, i));
    };
}
import { Search, ChevronLeft, Terminal, TerminalSquare, BookOpen, Copy, Check, Download, RefreshCw } from 'lucide-react';
import DownloadPanel from './DownloadPanel';

const HighlightedText = ({ text, searchTerms }) => {
    if (!searchTerms || searchTerms.length === 0) return <span>{text}</span>;
    // Highlight all search terms case-insensitively
    const escapedTerms = searchTerms.map(t => t.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'));
    const combinedRegex = new RegExp(`(${escapedTerms.join('|')})`, 'gi');
    const parts = text.split(combinedRegex);
    return (
        <span>
            {parts.map((part, i) =>
                searchTerms.some(t => t.toLowerCase() === part.toLowerCase()) ? (
                    <span key={i} className="search-highlight">{part}</span>
                ) : (
                    <span key={i}>{part}</span>
                )
            )}
        </span>
    );
};

export default function ClientViewer({ initialModules }) {
    const [modules, setModules] = useState(initialModules);
    const [reloading, setReloading] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [activeTab, setActiveTab] = useState('Academy');
    const [selectedModule, setSelectedModule] = useState(null);
    const [moduleTab, setModuleTab] = useState('content'); // 'content' | 'walkthrough'
    const [targetCommand, setTargetCommand] = useState(null);
    const [targetSearchTerm, setTargetSearchTerm] = useState(null);
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [expandedModules, setExpandedModules] = useState([]);
    const [toc, setToc] = useState([]);
    const [activeTocIndex, setActiveTocIndex] = useState(0);
    const [mounted, setMounted] = useState(false);  // gate: hide until hash is read

    // Tab-specific filters
    const [tabSearch, setTabSearch] = useState('');
    const [tabCommandSearch, setTabCommandSearch] = useState('');
    const [difficultyLevel, setDifficultyLevel] = useState('All');
    const [osFilter, setOsFilter] = useState('All');
    const [isTabDropdownOpen, setIsTabDropdownOpen] = useState(false);
    const [isDiffDropdownOpen, setIsDiffDropdownOpen] = useState(false);
    const [isOsDropdownOpen, setIsOsDropdownOpen] = useState(false);
    const [isTabSearchOpen, setIsTabSearchOpen] = useState(false);
    const [pwnedModules, setPwnedModules] = useState([]);

    const reloadModules = async () => {
        setReloading(true);
        try {
            const res = await fetch('/api/modules');
            const data = await res.json();
            if (data.modules) setModules(data.modules);
        } catch {}
        setReloading(false);
    };

    // ── Parse hash ───────────────────────────────────────────────────────────
    // Format: #academy, #box, #0xdf, #academy/ModuleName, #box/MachineName, etc.
    function parseHash() {
        const raw = window.location.hash.replace('#', '');
        const [tabPart, ...rest] = raw.split('/');
        let tab = 'Academy';
        if (tabPart.toLowerCase() === 'box') tab = 'Box';
        if (tabPart.toLowerCase() === '0xdf' || tabPart.toLowerCase() === 'htb_0xdf_box_writeups') tab = '0xdf';
        if (tabPart.toLowerCase() === 'download') tab = 'Download';

        const moduleSlug = rest.join('/') || null;
        return { tab, moduleSlug };
    }

    // useLayoutEffect runs synchronously AFTER DOM mutations but BEFORE paint.
    useLayoutEffect(() => {
        const syncFromHash = () => {
            const { tab, moduleSlug } = parseHash();
            setActiveTab(tab);
            if (moduleSlug) {
                const decoded = decodeURIComponent(moduleSlug);
                const found = modules.find(
                    m => m.id === decoded ||
                        m.title === decoded ||
                        (m.title && m.title.toLowerCase() === decoded.toLowerCase())
                );
                if (found) setSelectedModule(found);
                else setSelectedModule(null);
            } else {
                setSelectedModule(null);
            }
        };

        syncFromHash();

        // Listen for browser back/forward buttons
        window.addEventListener('popstate', syncFromHash);

        // Load pwned modules from localStorage
        const saved = localStorage.getItem('htb_pwned_modules');
        if (saved) {
            try {
                setPwnedModules(JSON.parse(saved));
            } catch (e) {
                console.error("Error loading pwned modules", e);
            }
        }

        setMounted(true);
        return () => window.removeEventListener('popstate', syncFromHash);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Persist pwned modules
    useEffect(() => {
        if (mounted) {
            localStorage.setItem('htb_pwned_modules', JSON.stringify(pwnedModules));
        }
    }, [pwnedModules, mounted]);

    const closeModule = () => {
        setSelectedModule(null);
        window.history.pushState(null, '', '#' + activeTab.toLowerCase());
    };


    // ── Navigation helpers (keep URL in sync) ────────────────────────────────
    const switchTab = (tab) => {
        setActiveTab(tab);
        setSelectedModule(null);
        setTabSearch('');
        setTabCommandSearch('');
        setDifficultyLevel('All');
        setOsFilter('All');
        window.history.pushState(null, '', '#' + tab.toLowerCase());
    };

    const openModule = (module) => {
        setModuleTab('content');
        setSelectedModule(module);
        const slug = encodeURIComponent(module.title || module.id);
        window.history.pushState(null, '', `#${activeTab.toLowerCase()}/${slug}`);
    };

    const isModulePwned = (m) => {
        return pwnedModules.includes(m.id) || (m.profile && !!m.profile.machinePwnedDate);
    };

    const togglePwned = (e, moduleId) => {
        e.stopPropagation();
        setPwnedModules(prev =>
            prev.includes(moduleId)
                ? prev.filter(id => id !== moduleId)
                : [...prev, moduleId]
        );
    };

    const dropdownRef = useRef(null);

    // Close dropdowns if clicked outside
    useEffect(() => {
        function handleClickOutside(event) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target) && !event.target.closest('.global-search-container')) {
                setIsDropdownOpen(false);
            }
            if (!event.target.closest('.tab-command-container')) {
                setIsTabDropdownOpen(false);
            }
            if (!event.target.closest('.tab-module-search-container')) {
                setIsTabSearchOpen(false);
            }
            if (!event.target.closest('.filter-select-group')) {
                setIsDiffDropdownOpen(false);
                setIsOsDropdownOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    // Scroll to command logic
    useEffect(() => {
        if (selectedModule && targetCommand) {
            const timer = setTimeout(() => {
                const codeBlocks = document.querySelectorAll('.interactive-code-block code');
                for (let block of codeBlocks) {
                    // Try to find exact matches or very close line matches to avoid broad false-positives
                    if (block.textContent.includes(targetCommand)) {
                        block.scrollIntoView({ behavior: 'auto', block: 'center' });
                        const container = block.closest('.interactive-code-block') || block;
                        const originalBoxShadow = container.style.boxShadow;
                        const originalBg = container.style.backgroundColor;
                        container.style.transition = 'all 0.3s ease';
                        container.style.boxShadow = '0 0 25px rgba(159, 239, 0, 0.4)';
                        container.style.backgroundColor = 'rgba(159, 239, 0, 0.1)';
                        setTimeout(() => {
                            container.style.boxShadow = originalBoxShadow;
                            container.style.backgroundColor = originalBg;
                        }, 2500);
                        break;
                    }
                }
                setTargetCommand(null);
            }, 500); // Wait for the page and layout to fully render and resize
            return () => clearTimeout(timer);
        }
    }, [selectedModule, targetCommand]);

    // Scroll to text logic from search
    useEffect(() => {
        if (selectedModule && targetSearchTerm) {
            const timer = setTimeout(() => {
                const query = targetSearchTerm.toLowerCase();
                const elements = document.querySelectorAll('.markdown-body p, .markdown-body li, .markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body td');

                for (let el of elements) {
                    if (el.textContent.toLowerCase().includes(query)) {
                        el.scrollIntoView({ behavior: 'auto', block: 'center' });

                        // Brief highlight
                        const originalBg = el.style.backgroundColor;
                        const originalTransition = el.style.transition;
                        el.style.transition = 'background-color 0.3s ease';
                        el.style.backgroundColor = 'rgba(159, 239, 0, 0.2)';
                        el.style.borderRadius = '4px';

                        setTimeout(() => {
                            el.style.backgroundColor = originalBg;
                            el.style.transition = originalTransition;
                        }, 2500);
                        break;
                    }
                }
                setTargetSearchTerm(null);
            }, 500);
            return () => clearTimeout(timer);
        }
    }, [selectedModule, targetSearchTerm]);


    const searchTerms = searchQuery.trim().toLowerCase().split(' ').filter(t => t);

    // Compute dropdown results for Global Search
    const searchResults = [];
    if (searchQuery.trim() !== '') {
        const query = searchQuery.trim().toLowerCase();
        modules.forEach(m => {
            const matchingCommands = m.commands.filter(c => {
                const lowerC = c.toLowerCase();
                // Recherche stricte de la chaîne uniquement (crucial pour la ponctuation et commandes avec options précises)
                return lowerC.includes(query);
            });
            if (matchingCommands.length > 0) {
                searchResults.push({ module: m, commands: matchingCommands });
            }
        });
    }

    // Compute dropdown results for Tab Command Search
    const tabSearchResults = [];
    if (tabCommandSearch.trim() !== '') {
        const query = tabCommandSearch.toLowerCase();
        modules.filter(m => m.type === activeTab).forEach(m => {
            const matchingCommands = m.commands.filter(c => c.toLowerCase().includes(query));
            if (matchingCommands.length > 0) {
                tabSearchResults.push({ module: m, commands: matchingCommands });
            }
        });
    }

    // Compute counts for tabs
    const academyCount = modules.filter(m => m.type === 'Academy').length;
    const boxCount = modules.filter(m => m.type === 'Box').length;
    const dfCount = modules.filter(m => m.type === '0xdf').length;

    // Compute filtered modules for the background grid
    let filteredModules = modules.filter(m => m.type === activeTab);

    // 1. Apply Global Search
    if (searchQuery.trim() !== '') {
        filteredModules = filteredModules.filter(m => {
            const combinedText = `${m.title} ${m.full_content}`.toLowerCase();
            return searchTerms.every(term => combinedText.includes(term)) || searchResults.some(r => r.module.id === m.id);
        });
    }

    // 2. Apply Tab-Specific Search (Name / Content)
    if (tabSearch.trim() !== '') {
        const query = tabSearch.toLowerCase();
        filteredModules = filteredModules.filter(m => {
            if (activeTab === 'Academy') {
                return m.title.toLowerCase().includes(query) || m.full_content.toLowerCase().includes(query);
            } else {
                return m.title.toLowerCase().includes(query);
            }
        });
    }

    // 3. Apply Tab-Specific Command Search
    if (tabCommandSearch.trim() !== '') {
        const query = tabCommandSearch.toLowerCase();
        filteredModules = filteredModules.filter(m => {
            return m.commands.some(c => c.toLowerCase().includes(query));
        });
    }

    // 4. Apply Difficulty Filter (Box and 0xdf)
    if ((activeTab === 'Box' || activeTab === '0xdf') && difficultyLevel !== 'All') {
        filteredModules = filteredModules.filter(m => {
            return m.profile && m.profile.difficultyText === difficultyLevel;
        });
    }

    // 5. Apply OS Filter (Box and 0xdf)
    if ((activeTab === 'Box' || activeTab === '0xdf') && osFilter !== 'All') {
        filteredModules = filteredModules.filter(m => {
            return m.profile && m.profile.os === osFilter;
        });
    }

    // Generate TOC when a module is selected
    useEffect(() => {
        if (selectedModule) {
            const headings = [];
            // Remove code blocks first to avoid matching '#' comments inside them
            const contentWithoutCode = selectedModule.full_content.replace(/```[\s\S]*?```/g, '');
            const regex = /^(#{1,3})\s+(.+)$/gm;
            let match;
            while ((match = regex.exec(contentWithoutCode)) !== null) {
                const level = match[1].length;
                let text = match[2].trim();
                // Strip markdown formatting (*, _)
                text = text.replace(/[*_`]/g, '');
                // Generate a simple id from the text (similar to how remark/rehype might do it if configured, or we can just scroll manually)
                const id = text.toLowerCase().replace(/[^\w]+/g, '-');
                headings.push({ level, text, id });
            }
            setToc(headings);
            setActiveTocIndex(0); // Reset le surlignage a chaque changement de module
        } else {
            setToc([]);
            setActiveTocIndex(0);
        }
    }, [selectedModule]);

    const handleScroll = (e) => {
        if (!selectedModule || toc.length === 0) return;

        const scrollDiv = e.target;
        const headers = document.querySelectorAll('.markdown-body h1, .markdown-body h2, .markdown-body h3');
        if (!headers.length) return;

        const containerTop = scrollDiv.getBoundingClientRect().top;
        let activeIdx = 0;

        for (let i = 0; i < headers.length; i++) {
            // Check position par rapport au haut de l'écran (250px d'offset pour activer la case dès qu'on s'en approche)
            const hTop = headers[i].getBoundingClientRect().top - containerTop;
            if (hTop < 250) {
                activeIdx = i;
            } else {
                break;
            }
        }

        if (activeIdx !== activeTocIndex) {
            setActiveTocIndex(activeIdx);
        }
    };

    const scrollToHeading = (e, index) => {
        e.preventDefault();
        const headers = document.querySelectorAll('.markdown-body h1, .markdown-body h2, .markdown-body h3');
        if (headers[index]) {
            headers[index].scrollIntoView({ behavior: 'auto', block: 'start' });
        }
    };

    const toggleExpand = (e, moduleId) => {
        e.stopPropagation();
        setExpandedModules(prev => prev.includes(moduleId) ? prev.filter(id => id !== moduleId) : [...prev, moduleId]);
    };

    const CodeBlock = ({ node, className, children, ...props }) => {
        const match = /language-(\w+)/.exec(className || '');
        const isBlock = match || String(children).includes('\n');

        if (!isBlock) {
            return <code className="inline-code" {...props}>{children}</code>;
        }

        const [copied, setCopied] = useState(false);
        const codeString = String(children).replace(/\n$/, '');

        const handleCopy = () => {
            navigator.clipboard.writeText(codeString);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        };

        return (
            <div className="interactive-code-block">
                <div className="code-header">
                    <span className="lang-badge">{match ? match[1] : 'bash'}</span>
                    <button onClick={handleCopy} className="copy-btn">
                        {copied ? <Check size={14} /> : <Copy size={14} />}
                        {copied ? 'Copié' : 'Copier'}
                    </button>
                </div>
                <pre>
                    <code className={className} {...props}>{children}</code>
                </pre>
            </div>
        );
    };

    // Don't render anything until the hash has been parsed client-side.
    // This prevents Academy from flashing before Box/module is known.
    if (!mounted) return null;

    return (

        <div className="app-container">
            {/* Top Header */}
            <header className="top-header">
                <div className="header-logo" onClick={() => closeModule()}>
                    <BookOpen className="icon green-text" size={28} />
                    <h2>HT<span style={{ color: 'var(--htb-green)' }}>Brain</span></h2>
                </div>

                <div className="global-search-container" ref={dropdownRef}>
                    <Search className="search-icon" size={18} />
                    <input
                        type="text"
                        placeholder="Rechercher une commande, un outil..."
                        value={searchQuery}
                        onChange={e => {
                            setSearchQuery(e.target.value);
                            setIsDropdownOpen(e.target.value.trim() !== '');
                            if (selectedModule) closeModule();
                        }}
                        onFocus={() => {
                            if (searchQuery.trim() !== '') setIsDropdownOpen(true);
                        }}
                    />

                    {/* SEARCH DROPDOWN */}
                    {isDropdownOpen && searchResults.length > 0 && (
                        <div className="search-dropdown">
                            {searchResults.map((result, index) => {
                                const isExpanded = expandedModules.includes(result.module.id);
                                const displayedCommands = isExpanded ? result.commands : result.commands.slice(0, 3);
                                const hiddenCount = result.commands.length - 3;

                                return (
                                    <div key={index} className="search-module-group">
                                        <div className="search-module-header">
                                            <h3 className="search-module-title" onClick={() => {
                                                openModule(result.module);
                                                setTargetSearchTerm(searchQuery);
                                                setIsDropdownOpen(false);
                                            }} style={{ cursor: 'pointer' }}>{result.module.title}</h3>
                                            <div className="search-module-meta">
                                                <span className="search-module-badge">Module</span>
                                                <span className="search-module-badge">{result.commands.length} commandes trouvées</span>
                                            </div>
                                        </div>

                                        {displayedCommands.map((cmd, i) => (
                                            <div key={i} className="search-command-block" onClick={() => {
                                                openModule(result.module);
                                                setTargetCommand(cmd);
                                                setIsDropdownOpen(false);
                                            }}>
                                                <div className="search-command-line">
                                                    <span className="search-command-prompt">{'>_'}</span>
                                                    <span><HighlightedText text={cmd} searchTerms={searchTerms} /></span>
                                                </div>
                                            </div>
                                        ))}

                                        {!isExpanded && hiddenCount > 0 && (
                                            <div style={{ textAlign: 'left' }}>
                                                <button className="view-more-btn" onClick={(e) => toggleExpand(e, result.module.id)}>
                                                    View {hiddenCount} more commands in {result.module.title} &rarr;
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    {isDropdownOpen && searchResults.length === 0 && searchQuery.trim() !== '' && (
                        <div className="search-dropdown" style={{ textAlign: 'center', padding: '32px', color: 'var(--text-light)' }}>
                            <Terminal size={32} style={{ margin: '0 auto 12px auto', opacity: 0.5 }} />
                            <p>Aucune commande trouvée pour "{searchQuery}".</p>
                        </div>
                    )}
                </div>
            </header>

            {/* Sub-navbar Tabs */}
            {!selectedModule && (
                <div className="sub-navbar">
                    <div className="tabs-container">
                        <button
                            className={`tab-button ${activeTab === 'Academy' ? 'active' : ''}`}
                            onClick={() => switchTab('Academy')}
                        >
                            <BookOpen size={16} /> Academy <span className="tab-count">{academyCount}</span>
                        </button>
                        <button
                            className={`tab-button ${activeTab === 'Box' ? 'active' : ''}`}
                            onClick={() => switchTab('Box')}
                        >
                            <TerminalSquare size={16} /> Box <span className="tab-count">{boxCount}</span>
                        </button>
                        <button
                            className={`tab-button ${activeTab === '0xdf' ? 'active' : ''}`}
                            onClick={() => switchTab('0xdf')}
                        >
                            <BookOpen size={16} /> 0xdf <span className="tab-count">{dfCount}</span>
                        </button>
                        <button
                            className={`tab-button ${activeTab === 'Download' ? 'active' : ''}`}
                            onClick={() => switchTab('Download')}
                        >
                            <Download size={16} /> Downloader
                        </button>
                    </div>

                    {activeTab !== 'Download' && <div className="tab-filters-bar">
                        {activeTab === 'Academy' ? (
                            <>
                                <div className="filter-input-group tab-module-search-container">
                                    <Search size={14} className="filter-icon" />
                                    <input
                                        type="text"
                                        placeholder="Chercher dans les cours (nom/contenu)..."
                                        value={tabSearch}
                                        onChange={(e) => {
                                            setTabSearch(e.target.value);
                                            setIsTabSearchOpen(e.target.value.trim() !== '');
                                        }}
                                        onFocus={() => {
                                            if (tabSearch.trim() !== '') setIsTabSearchOpen(true);
                                        }}
                                    />
                                    {isTabSearchOpen && filteredModules.length > 0 && (
                                        <div className="search-dropdown tab-search-dropdown module-search-dropdown">
                                            {filteredModules.slice(0, 8).map((m, idx) => {
                                                // Find the best snippet if the search matches content
                                                let snippet = m.preview;
                                                const query = tabSearch.toLowerCase();
                                                if (m.full_content && m.full_content.toLowerCase().includes(query)) {
                                                    const idxStart = m.full_content.toLowerCase().indexOf(query);
                                                    const start = Math.max(0, idxStart - 40);
                                                    const end = Math.min(m.full_content.length, idxStart + 80);
                                                    snippet = (start > 0 ? "..." : "") +
                                                        m.full_content.substring(start, end)
                                                            .replace(/#+\s+/g, '')
                                                            .replace(/[*_~`]/g, '') + "...";
                                                }

                                                return (
                                                    <div
                                                        key={idx}
                                                        className="search-module-item"
                                                        onClick={() => {
                                                            openModule(m);
                                                            setTargetSearchTerm(tabSearch);
                                                            setIsTabSearchOpen(false);
                                                        }}
                                                    >
                                                        <div className="search-module-info">
                                                            <BookOpen size={14} className="green-text" />
                                                            <span className="search-module-title">
                                                                <HighlightedText text={m.title} searchTerms={[tabSearch]} />
                                                            </span>
                                                        </div>
                                                        <p className="search-module-preview">
                                                            <HighlightedText text={snippet} searchTerms={[tabSearch]} />
                                                        </p>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                                <div className="filter-input-group tab-command-container">
                                    <Terminal size={14} className="filter-icon" />
                                    <input
                                        type="text"
                                        placeholder="Chercher une commande..."
                                        value={tabCommandSearch}
                                        onChange={(e) => {
                                            setTabCommandSearch(e.target.value);
                                            setIsTabDropdownOpen(true);
                                        }}
                                        onFocus={() => setIsTabDropdownOpen(true)}
                                    />
                                    {isTabDropdownOpen && tabSearchResults.length > 0 && (
                                        <div className="search-dropdown tab-search-dropdown">
                                            {tabSearchResults.map((result, idx) => (
                                                <div key={idx} className="search-module-group">
                                                    <div className="search-module-header">
                                                        <h4 className="search-module-title-mini">{result.module.title}</h4>
                                                    </div>
                                                    {result.commands.slice(0, 5).map((cmd, i) => (
                                                        <div key={i} className="search-command-block mini" onClick={() => {
                                                            openModule(result.module);
                                                            setTargetCommand(cmd);
                                                            setIsTabDropdownOpen(false);
                                                        }}>
                                                            <div className="search-command-line">
                                                                <span className="search-command-prompt">{'>_'}</span>
                                                                <span>{cmd}</span>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="filter-input-group tab-module-search-container">
                                    <Search size={14} className="filter-icon" />
                                    <input
                                        type="text"
                                        placeholder={activeTab === 'Box' ? "Chercher une box..." : "Chercher un writeup 0xdf..."}
                                        value={tabSearch}
                                        onChange={(e) => {
                                            setTabSearch(e.target.value);
                                            setIsTabSearchOpen(e.target.value.trim() !== '');
                                        }}
                                        onFocus={() => {
                                            if (tabSearch.trim() !== '') setIsTabSearchOpen(true);
                                        }}
                                    />
                                    {isTabSearchOpen && filteredModules.length > 0 && (
                                        <div className="search-dropdown tab-search-dropdown module-search-dropdown">
                                            {filteredModules.slice(0, 8).map((m, idx) => (
                                                <div
                                                    key={idx}
                                                    className="search-module-item"
                                                    onClick={() => {
                                                        openModule(m);
                                                        setTargetSearchTerm(tabSearch);
                                                        setIsTabSearchOpen(false);
                                                    }}
                                                >
                                                    <div className="search-module-info">
                                                        <TerminalSquare size={14} className="green-text" />
                                                        <span className="search-module-title">
                                                            <HighlightedText text={m.title} searchTerms={[tabSearch]} />
                                                        </span>
                                                    </div>
                                                    <p className="search-module-preview">{m.preview.substring(0, 80)}...</p>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                <div className="filter-select-group">
                                    <div className="custom-select" onClick={() => setIsDiffDropdownOpen(!isDiffDropdownOpen)}>
                                        <span>Difficulté: {difficultyLevel === 'All' ? 'Toutes' : difficultyLevel}</span>
                                        <ChevronLeft size={14} style={{ transform: isDiffDropdownOpen ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }} />
                                    </div>
                                    {isDiffDropdownOpen && (
                                        <div className="custom-select-menu">
                                            {['All', 'Easy', 'Medium', 'Hard', 'Insane'].map(diff => (
                                                <div
                                                    key={diff}
                                                    className={`custom-select-item ${difficultyLevel === diff ? 'active' : ''}`}
                                                    onClick={() => {
                                                        setDifficultyLevel(diff);
                                                        setIsDiffDropdownOpen(false);
                                                    }}
                                                >
                                                    {diff === 'All' ? 'Toutes' : diff}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                <div className="filter-select-group">
                                    <div className="custom-select" onClick={() => setIsOsDropdownOpen(!isOsDropdownOpen)}>
                                        <span>OS: {osFilter === 'All' ? 'Tous' : osFilter}</span>
                                        <ChevronLeft size={14} style={{ transform: isOsDropdownOpen ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }} />
                                    </div>
                                    {isOsDropdownOpen && (
                                        <div className="custom-select-menu">
                                            {['All', 'Linux', 'Windows'].map(os => (
                                                <div
                                                    key={os}
                                                    className={`custom-select-item ${osFilter === os ? 'active' : ''}`}
                                                    onClick={() => {
                                                        setOsFilter(os);
                                                        setIsOsDropdownOpen(false);
                                                    }}
                                                >
                                                    {os === 'All' ? 'Tous' : os}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                <div className="filter-input-group tab-command-container">
                                    <Terminal size={14} className="filter-icon" />
                                    <input
                                        type="text"
                                        placeholder="Chercher une commande..."
                                        value={tabCommandSearch}
                                        onChange={(e) => {
                                            setTabCommandSearch(e.target.value);
                                            setIsTabDropdownOpen(true);
                                        }}
                                        onFocus={() => setIsTabDropdownOpen(true)}
                                    />
                                    {isTabDropdownOpen && tabSearchResults.length > 0 && (
                                        <div className="search-dropdown tab-search-dropdown">
                                            {tabSearchResults.map((result, idx) => (
                                                <div key={idx} className="search-module-group">
                                                    <div className="search-module-header">
                                                        <h4 className="search-module-title-mini">{result.module.title}</h4>
                                                    </div>
                                                    {result.commands.slice(0, 5).map((cmd, i) => (
                                                        <div key={i} className="search-command-block mini" onClick={() => {
                                                            openModule(result.module);
                                                            setTargetCommand(cmd);
                                                            setIsTabDropdownOpen(false);
                                                        }}>
                                                            <div className="search-command-line">
                                                                <span className="search-command-prompt">{'>_'}</span>
                                                                <span>{cmd}</span>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </>
                        )}
                    </div>}
                </div>
            )}

            {/* Main Content */}
            <main className="main-content">
                <div className="content-scrollable" onScroll={handleScroll}>
                    {activeTab === 'Download' ? (
                        <DownloadPanel />
                    ) : !selectedModule ? (
                        <div className="modules-grid-container">
                            {filteredModules.length === 0 ? (
                                <div className="empty-state">
                                    <Terminal size={64} className="green-text opacity-50" />
                                    <h2>Aucun module trouvé</h2>
                                </div>
                            ) : (
                                <div className="modules-grid">
                                    {filteredModules.map((m) => {
                                        const isAcademy = m.type === 'Academy';

                                        if (isAcademy) {
                                            return (
                                                <div
                                                    key={m.id}
                                                    className={`module-card academy-card ${isModulePwned(m) ? 'pwned' : ''}`}
                                                    onClick={() => openModule(m)}
                                                >
                                                    <div className="academy-card-image">
                                                        {(m.logoUrl || m.icon) ? (
                                                            <img
                                                                src={m.logoUrl || `/api/image?module=${encodeURIComponent(m.id)}&image=${encodeURIComponent(m.icon)}`}
                                                                alt={m.title}
                                                            />
                                                        ) : (
                                                            <div className="academy-card-placeholder"><BookOpen size={48} /></div>
                                                        )}
                                                        <div className="academy-card-overlay"></div>
                                                    </div>
                                                    <div className="academy-card-content">
                                                        <div className="academy-card-header">
                                                            <BookOpen size={16} className="green-text" />
                                                            <h3 className="academy-title">{m.title}</h3>
                                                        </div>
                                                        <p className="academy-preview">{m.preview}</p>
                                                        <div className="academy-card-footer">
                                                            <span className="command-count">
                                                                <Terminal size={12} /> {m.commands.length} commandes
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        }

                                        return (
                                            <div
                                                key={m.id}
                                                className={`module-card bubble-card box-card ${isModulePwned(m) ? 'pwned' : ''}`}
                                                onClick={() => openModule(m)}
                                            >
                                                <button
                                                    className={`pwned-toggle ${isModulePwned(m) ? 'active' : ''}`}
                                                    onClick={(e) => togglePwned(e, m.id)}
                                                    title={isModulePwned(m) ? "Marquer comme non fait" : "Marquer comme pwned"}
                                                >
                                                    <Check size={16} />
                                                </button>
                                                {(m.logoUrl || m.icon) && (
                                                    <img
                                                        src={m.logoUrl || `/api/image?module=${encodeURIComponent(m.id)}&image=${encodeURIComponent(m.icon)}`}
                                                        alt={`${m.title} icon`}
                                                        className="module-avatar"
                                                    />
                                                )}
                                                <h3 className="module-title" style={(m.logoUrl || m.icon) ? { marginTop: '12px' } : {}}>{m.title}</h3>
                                                {m.profile && (m.profile.os || m.profile.difficultyText) && (
                                                    <div className="module-meta-info">
                                                        {m.profile.os && (
                                                            <span className="meta-os">{m.profile.os}</span>
                                                        )}
                                                        {m.profile.difficultyText && (
                                                            <span className={`meta-diff diff-${m.profile.difficultyText.toLowerCase().replace(' ', '-')}`}>
                                                                {m.profile.difficultyText}
                                                            </span>
                                                        )}
                                                    </div>
                                                )}
                                                {m.profile && m.profile.release && (
                                                    <div className="meta-date">
                                                        {new Date(m.profile.release).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
                                                    </div>
                                                )}
                                                {m.profile && m.profile.machinePwnedDate && (
                                                    <div className="pwned-date-info">
                                                        Pwned the {new Date(m.profile.machinePwnedDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="module-view">
                            <div className="module-view-topbar">
                                <button className="back-btn" onClick={() => closeModule()}>
                                    <ChevronLeft size={20} /> Retour aux modules
                                </button>
                                {selectedModule.walkthrough && (
                                    <div className="module-tabs">
                                        <button
                                            className={`module-tab-btn ${moduleTab === 'content' ? 'active' : ''}`}
                                            onClick={() => setModuleTab('content')}
                                        >
                                            Cours
                                        </button>
                                        <button
                                            className={`module-tab-btn ${moduleTab === 'walkthrough' ? 'active' : ''}`}
                                            onClick={() => setModuleTab('walkthrough')}
                                        >
                                            Walkthrough
                                        </button>
                                    </div>
                                )}
                            </div>

                            <div className="module-view-layout">
                                {/* TOC Sidebar */}
                                {toc.length > 0 && (
                                    <aside className="module-toc">
                                        <h3>Sommaire</h3>
                                        <ul>
                                            {toc.map((heading, idx) => (
                                                <li key={idx}>
                                                    <a
                                                        href={`#${heading.id}`}
                                                        onClick={(e) => scrollToHeading(e, idx)}
                                                        className={`toc-level-${heading.level} ${activeTocIndex === idx ? 'active-toc-item' : ''}`}
                                                    >
                                                        {heading.text}
                                                    </a>
                                                </li>
                                            ))}
                                        </ul>
                                    </aside>
                                )}

                                {/* Main Article */}
                                <div className="module-view-content">
                                    <article className="markdown-body">
                                        <ReactMarkdown
                                            remarkPlugins={[remarkGfm]}
                                            rehypePlugins={[rehypeRaw, rehypeEscapeUnknownTags]}
                                            components={{
                                                pre: ({ children }) => <>{children}</>,
                                                code: CodeBlock,
                                                // Override <p> to avoid nesting block elements inside it
                                                p({ children }) {
                                                    const hasBlock = Array.isArray(children)
                                                        ? children.some(c => c?.type === 'img' || (typeof c === 'object' && c?.props?.className === 'img-container'))
                                                        : children?.type === 'img';
                                                    return hasBlock
                                                        ? <div className="md-paragraph">{children}</div>
                                                        : <p className="md-paragraph">{children}</p>;
                                                },
                                                img({ node, src, alt, ...props }) {
                                                    let newSrc = src;
                                                    if (src && !src.startsWith("http")) {
                                                        newSrc = `/api/image?module=${encodeURIComponent(selectedModule.id)}&image=${encodeURIComponent(src)}`;
                                                    }
                                                    return (
                                                        <span className="img-container">
                                                            <img src={newSrc} alt={alt} {...props} style={{ maxWidth: '100%', borderRadius: '8px', border: '1px solid #3e4a59', display: 'block' }} />
                                                            {alt && <span className="img-caption">{alt}</span>}
                                                        </span>
                                                    );
                                                }
                                            }}
                                        >
                                            {moduleTab === 'walkthrough' && selectedModule.walkthrough
                                                ? selectedModule.walkthrough
                                                : selectedModule.full_content}
                                        </ReactMarkdown>
                                    </article>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}

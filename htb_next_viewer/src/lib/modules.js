import fs from 'fs';
import path from 'path';

export function getLocalModules() {
    const rootDir = process.cwd();

    // Check both HTB_Modules, HTB_official_box_writeups, and 0xdf writeups
    const directories = [
        path.join(rootDir, '../', 'data', 'HTB_Modules'),
        path.join(rootDir, '../', 'data', 'HTB_official_box_writeups'),
        path.join(rootDir, '../', 'data', 'HTB_0xdf_box_writeups')
    ];

    const modulesData = [];

    for (const targetDir of directories) {
        if (!fs.existsSync(targetDir)) continue;

        const folders = fs.readdirSync(targetDir);

        for (const folder of folders) {
            const folderPath = path.join(targetDir, folder);
            const stat = fs.statSync(folderPath);

            // New fork binary flat format: module-name-module-ID.md
            if (stat.isFile() && folder.endsWith('.md') && /^.+-module-\d+\.md$/.test(folder)) {
                let content = fs.readFileSync(folderPath, 'utf8');

                const moduleIdMatch = folder.match(/-module-(\d+)\.md$/);
                const moduleId = moduleIdMatch ? moduleIdMatch[1] : null;

                const titleRaw = folder.replace(/-module-\d+\.md$/, '').replace(/-/g, ' ');
                const title = titleRaw.replace(/\b\w/g, c => c.toUpperCase());

                const commands = [];
                const regexFlat = /^```(.*)\n([\s\S]*?)^```/gm;
                let matchFlat;
                while ((matchFlat = regexFlat.exec(content)) !== null) {
                    for (let line of matchFlat[2].trim().split('\n')) {
                        line = line.trim();
                        if (line && !line.startsWith('//') && !line.startsWith('/*')) {
                            commands.push(line);
                        }
                    }
                }

                const cleanPreviewText = content
                    .replace(/#+\s+/g, '')
                    .replace(/[*_~`]/g, '')
                    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
                    .replace(/!\[[^\]]*\]\([^\)]+\)/g, '')
                    .replace(/\n+/g, ' ')
                    .trim();

                let type = 'Academy';
                if (targetDir.endsWith('HTB_official_box_writeups')) type = 'Box';
                else if (targetDir.endsWith('HTB_0xdf_box_writeups')) type = '0xdf';

                modulesData.push({
                    id: folder.replace('.md', ''),
                    title,
                    type,
                    icon: null,
                    logoUrl: moduleId ? `/api/module-logo?id=${moduleId}` : null,
                    profile: {},
                    path: targetDir,
                    commands,
                    commandsString: commands.join(' \n '),
                    preview: cleanPreviewText.substring(0, 160) + '...',
                    full_content: content,
                });
                continue;
            }

            if (stat.isDirectory()) {
                const files = fs.readdirSync(folderPath);

                // Flat file format inside a subdirectory (e.g. HTB_Modules/modules/name-module-ID.md)
                const flatMdFiles = files.filter(f => f.endsWith('.md') && /^.+-module-\d+\.md$/.test(f) && !f.includes('-walkthrough'));
                if (flatMdFiles.length > 0) {
                    let type = 'Academy';
                    if (targetDir.endsWith('HTB_official_box_writeups')) type = 'Box';
                    else if (targetDir.endsWith('HTB_0xdf_box_writeups')) type = '0xdf';

                    for (const flatFile of flatMdFiles) {
                        let content = fs.readFileSync(path.join(folderPath, flatFile), 'utf8');
                        const flatIdMatch = flatFile.match(/-module-(\d+)\.md$/);
                        const flatModuleId = flatIdMatch ? flatIdMatch[1] : null;
                        const titleRaw = flatFile.replace(/-module-\d+\.md$/, '').replace(/-/g, ' ');
                        const title = titleRaw.replace(/\b\w/g, c => c.toUpperCase());

                        const commands = [];
                        const regexFlat = /^```(.*)\n([\s\S]*?)^```/gm;
                        let matchFlat;
                        while ((matchFlat = regexFlat.exec(content)) !== null) {
                            for (let line of matchFlat[2].trim().split('\n')) {
                                line = line.trim();
                                if (line && !line.startsWith('//') && !line.startsWith('/*')) commands.push(line);
                            }
                        }

                        const cleanPreviewText = content
                            .replace(/#+\s+/g, '').replace(/[*_~`]/g, '')
                            .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
                            .replace(/!\[[^\]]*\]\([^\)]+\)/g, '')
                            .replace(/\n+/g, ' ').trim();

                        // Load walkthrough if available
                        const walkthroughFile = flatFile.replace('.md', '-walkthrough.md');
                        let walkthroughContent = null;
                        const walkthroughPath = path.join(folderPath, walkthroughFile);
                        if (fs.existsSync(walkthroughPath)) {
                            walkthroughContent = fs.readFileSync(walkthroughPath, 'utf8');
                        }

                        modulesData.push({
                            id: flatFile.replace('.md', ''),
                            title, type,
                            icon: null,
                            logoUrl: flatModuleId ? `/api/module-logo?id=${flatModuleId}` : null,
                            profile: {},
                            path: folderPath,
                            commands,
                            commandsString: commands.join(' \n '),
                            preview: cleanPreviewText.substring(0, 160) + '...',
                            full_content: content,
                            walkthrough: walkthroughContent,
                        });
                    }
                    continue;
                }

                const mdFile = files.find(file => file.endsWith('.md'));

                if (mdFile) {
                    const mdPath = path.join(folderPath, mdFile);
                    let content = fs.readFileSync(mdPath, 'utf8');

                    // Utiliser le nom du dossier comme titre du module
                    let title = folder.replace(/_/g, ' ');

                    // Extraire les commandes des blocs de code
                    const commands = [];
                    const regex = /^```(.*)\n([\s\S]*?)^```/gm;
                    let match;
                    while ((match = regex.exec(content)) !== null) {
                        const blockContent = match[2].trim();
                        const lines = blockContent.split('\n');
                        for (let line of lines) {
                            line = line.trim();
                            // Filtrer basiquement pour ne garder que le texte qui ressemble aux commandes
                            if (line && !line.startsWith('//') && !line.startsWith('/*')) {
                                commands.push(line);
                            }
                        }
                    }

                    // Determine type based on directory
                    let type = 'Academy';
                    if (targetDir.endsWith('HTB_official_box_writeups')) {
                        type = 'Box';
                    } else if (targetDir.endsWith('HTB_0xdf_box_writeups')) {
                        type = '0xdf';
                    }

                    // Check for an icon
                    let iconPath = null;
                    const possibleIcons = ['icon.png', 'avatar.png', 'logo.png'];
                    for (const ic of possibleIcons) {
                        if (files.includes(ic)) {
                            iconPath = ic;
                            break;
                        }
                    }

                    // Fallback: Use the very first image referenced in the Markdown as the logo
                    if (!iconPath) {
                        const firstImageMatch = content.match(/!\[.*?\]\((.*?)\)/);
                        if (firstImageMatch && firstImageMatch[1]) {
                            // Safely extract just the file name
                            // (e.g. from "./image.png", "folder/image.png", or "image.png")
                            const imgName = firstImageMatch[1].split('/').pop().split('?')[0].split('#')[0];
                            // Clean URL-encoded strings (like spaces %20) that the scraper might have placed
                            try {
                                const decodedImgName = decodeURIComponent(imgName);
                                if (files.includes(decodedImgName)) {
                                    iconPath = decodedImgName;
                                } else if (files.includes(imgName)) {
                                    iconPath = imgName;
                                }
                            } catch (e) {
                                if (files.includes(imgName)) {
                                    iconPath = imgName;
                                }
                            }
                        }
                    }

                    // Load metadata from profile.json if it exists
                    let profile = {};
                    if (files.includes('profile.json')) {
                        try {
                            const profilePath = path.join(folderPath, 'profile.json');
                            profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
                        } catch (e) {
                            console.error(`Error parsing profile.json for ${folder}:`, e);
                        }
                    } else if (content.startsWith('---')) {
                        // Extract frontmatter if exists (mainly for 0xdf scraper format)
                        const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
                        if (fmMatch) {
                            const fmLines = fmMatch[1].split('\n');
                            fmLines.forEach(l => {
                                const parts = l.split(':');
                                if (parts.length >= 2) {
                                    const k = parts[0].trim();
                                    const v = parts.slice(1).join(':').trim();
                                    if (k === 'difficulty') profile.difficultyText = v;
                                    if (k === 'os') profile.os = v;
                                    if (k === 'ip') profile.ip = v;
                                    if (k === 'date') profile.release = v;
                                }
                            });
                            // Remove frontmatter from content to prevent display issues
                            content = content.replace(/^---\n[\s\S]*?\n---\n+/, '');
                        }
                    }

                    // Clean content for preview (strip markdown)
                    const cleanPreviewText = content
                        .replace(/#+\s+/g, '') // Remove headers
                        .replace(/[*_~`]/g, '') // Remove style chars
                        .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1') // Remove links but keep text
                        .replace(/!\[[^\]]*\]\([^\)]+\)/g, '') // Remove images
                        .replace(/\n+/g, ' ') // Replace newlines with spaces
                        .trim();

                    modulesData.push({
                        id: folder,
                        title: title,
                        type: type,
                        icon: iconPath,
                        profile: profile,
                        path: folderPath,
                        commands: commands,
                        commandsString: commands.join(' \n '),
                        preview: cleanPreviewText.substring(0, 160) + "...",
                        full_content: content
                    });
                }
            }
        }
    }

    return modulesData;
}

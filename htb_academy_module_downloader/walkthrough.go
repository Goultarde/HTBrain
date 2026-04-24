package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	md "github.com/JohannesKaufmann/html-to-markdown"
	"github.com/JohannesKaufmann/html-to-markdown/plugin"
	"golang.org/x/net/html"
)

// processOfflineWalkthrough traite tous les fichiers HTML d'un répertoire
// et extrait le contenu du walkthroughModal pour le convertir en Markdown
func processOfflineWalkthrough(directory string) error {
	// Vérifier que le répertoire existe
	if _, err := os.Stat(directory); os.IsNotExist(err) {
		return fmt.Errorf("le répertoire %s n'existe pas", directory)
	}

	// Créer le dossier de sortie pour les walkthroughs
	outputDir := filepath.Join(directory, "walkthroughs_markdown")
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return fmt.Errorf("impossible de créer le dossier de sortie: %v", err)
	}

	fmt.Printf("Création du dossier de sortie: %s\n", outputDir)

	// Parcourir tous les fichiers HTML du répertoire
	files, err := filepath.Glob(filepath.Join(directory, "*.html"))
	if err != nil {
		return fmt.Errorf("erreur lors de la recherche des fichiers HTML: %v", err)
	}

	if len(files) == 0 {
		return fmt.Errorf("aucun fichier HTML trouvé dans %s", directory)
	}

	fmt.Printf("Traitement de %d fichier(s) HTML...\n", len(files))

	processedCount := 0
	for _, file := range files {
		fmt.Printf("Traitement de: %s\n", filepath.Base(file))
		
		// Lire le contenu du fichier HTML
		content, err := os.ReadFile(file)
		if err != nil {
			fmt.Printf("  ⚠ Erreur lors de la lecture: %v\n", err)
			continue
		}

		// Extraire le contenu du walkthroughModal
		walkthroughContent, err := extractWalkthroughModal(string(content))
		if err != nil {
			fmt.Printf("  ⚠ Pas de walkthroughModal trouvé: %v\n", err)
			continue
		}

		// Log pour debug
		fmt.Printf("  → Contenu HTML extrait: %d caractères\n", len(walkthroughContent))

		// Convertir en Markdown
		markdownContent, err := convertWalkthroughToMarkdown(walkthroughContent)
		if err != nil {
			fmt.Printf("  ⚠ Erreur lors de la conversion: %v\n", err)
			continue
		}

		// Log pour debug
		fmt.Printf("  → Contenu Markdown généré: %d caractères\n", len(markdownContent))

		// Générer le nom du fichier de sortie
		baseName := strings.TrimSuffix(filepath.Base(file), filepath.Ext(file))
		outputFile := filepath.Join(outputDir, baseName+"_walkthrough.md")

		// Écrire le fichier Markdown
		if err := os.WriteFile(outputFile, []byte(markdownContent), 0644); err != nil {
			fmt.Printf("  ⚠ Erreur lors de l'écriture: %v\n", err)
			continue
		}

		fmt.Printf("  ✓ Converti vers: %s\n", filepath.Base(outputFile))
		processedCount++
	}

	fmt.Printf("\nConversion terminée: %d/%d fichiers traités avec succès\n", processedCount, len(files))
	if processedCount > 0 {
		fmt.Printf("Fichiers sauvegardés dans: %s\n", outputDir)
	}

	return nil
}

// extractWalkthroughModal extrait le contenu HTML de l'élément avec l'ID walkthroughModal
func extractWalkthroughModal(htmlContent string) (string, error) {
	doc, err := html.Parse(strings.NewReader(htmlContent))
	if err != nil {
		return "", err
	}

	// Chercher l'élément avec l'ID walkthroughModal
	walkthroughNode := findElementById(doc, "walkthroughModal")
	if walkthroughNode == nil {
		return "", fmt.Errorf("walkthroughModal non trouvé")
	}

	// Chercher le contenu dans la div avec class "training-module" à l'intérieur du modal
	trainingModuleNode := findElementByClass(walkthroughNode, "training-module")
	if trainingModuleNode != nil {
		// Extraire uniquement le contenu interne de training-module
		var contentBuilder strings.Builder
		for c := trainingModuleNode.FirstChild; c != nil; c = c.NextSibling {
			if err := html.Render(&contentBuilder, c); err == nil {
				// On continue même si une erreur survient sur un nœud
			}
		}
		return contentBuilder.String(), nil
	}

	// Si on ne trouve pas training-module, on retourne tout le contenu du modal
	var result strings.Builder
	if err := html.Render(&result, walkthroughNode); err != nil {
		return "", err
	}

	return result.String(), nil
}

// findElementByClass recherche récursivement un élément par sa classe
func findElementByClass(n *html.Node, class string) *html.Node {
	if n.Type == html.ElementNode {
		for _, a := range n.Attr {
			if a.Key == "class" && strings.Contains(a.Val, class) {
				return n
			}
		}
	}
	
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if element := findElementByClass(c, class); element != nil {
			return element
		}
	}
	
	return nil
}

// findElementById recherche récursivement un élément par son ID
func findElementById(n *html.Node, id string) *html.Node {
	if n.Type == html.ElementNode {
		for _, a := range n.Attr {
			if a.Key == "id" && a.Val == id {
				return n
			}
		}
	}
	
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if element := findElementById(c, id); element != nil {
			return element
		}
	}
	
	return nil
}

// convertWalkthroughToMarkdown convertit le contenu HTML du walkthrough en Markdown
func convertWalkthroughToMarkdown(htmlContent string) (string, error) {
	// Si le contenu est trop court, il y a probablement un problème
	if len(htmlContent) < 50 {
		return "", fmt.Errorf("contenu HTML trop court, probablement invalide")
	}

	// Configurer le convertisseur Markdown
	converter := md.NewConverter("", true, nil)
	converter.Use(plugin.GitHubFlavored())

	// Convertir en Markdown
	markdown, err := converter.ConvertString(htmlContent)
	if err != nil {
		return "", err
	}

	// Post-traitement du Markdown
	markdown = postProcessWalkthroughMarkdown(markdown)

	// Vérifier que le markdown n'est pas vide
	if strings.TrimSpace(markdown) == "" || strings.TrimSpace(markdown) == "# Walkthrough" {
		return "", fmt.Errorf("conversion en markdown a échoué - contenu vide")
	}

	return markdown, nil
}

// cleanWalkthroughHTML nettoie le HTML avant la conversion
func cleanWalkthroughHTML(htmlContent string) string {
	doc, err := html.Parse(strings.NewReader(htmlContent))
	if err != nil {
		return htmlContent
	}

	// Supprimer les éléments inutiles (scripts, styles, etc.)
	removeUnwantedElements(doc)

	// Extraire uniquement le contenu pertinent du modal
	modalBody := findModalBody(doc)
	if modalBody != nil {
		var result strings.Builder
		if err := html.Render(&result, modalBody); err == nil {
			return result.String()
		}
	}

	return htmlContent
}

// findModalBody trouve le corps du modal (modal-body ou contenu principal)
func findModalBody(n *html.Node) *html.Node {
	if n.Type == html.ElementNode && n.Data == "div" {
		for _, a := range n.Attr {
			if a.Key == "class" && strings.Contains(a.Val, "modal-body") {
				return n
			}
		}
	}
	
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if body := findModalBody(c); body != nil {
			return body
		}
	}
	
	return n // Retourner le nœud original si pas de modal-body trouvé
}

// removeUnwantedElements supprime les éléments non désirés du HTML
func removeUnwantedElements(n *html.Node) {
	var toRemove []*html.Node
	
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if c.Type == html.ElementNode {
			switch c.Data {
			case "script", "style", "noscript":
				toRemove = append(toRemove, c)
			case "div", "button":
				// Vérifier si c'est un élément de fermeture du modal ou autre élément UI
				for _, a := range c.Attr {
					if a.Key == "class" && (strings.Contains(a.Val, "modal-header") || 
						strings.Contains(a.Val, "modal-footer") || 
						strings.Contains(a.Val, "close")) {
						toRemove = append(toRemove, c)
						break
					}
				}
			}
		}
		removeUnwantedElements(c)
	}
	
	for _, node := range toRemove {
		if node.Parent != nil {
			node.Parent.RemoveChild(node)
		}
	}
}

// postProcessWalkthroughMarkdown effectue un post-traitement sur le Markdown généré
func postProcessWalkthroughMarkdown(markdown string) string {
	// Nettoyer les lignes vides multiples
	lines := strings.Split(markdown, "\n")
	var cleaned []string
	emptyCount := 0
	
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			emptyCount++
			if emptyCount <= 2 {
				cleaned = append(cleaned, line)
			}
		} else {
			emptyCount = 0
			cleaned = append(cleaned, line)
		}
	}
	
	result := strings.Join(cleaned, "\n")
	
	// Remplacements spécifiques pour HTB Academy
	result = strings.ReplaceAll(result, "shell-session", "shell")
	result = strings.ReplaceAll(result, "powershell-session", "powershell")
	result = strings.ReplaceAll(result, "[!bash!]$ ", "")
	
	// Corriger les chemins d'images avec des espaces
	// Rechercher les patterns d'images Markdown et encoder les espaces dans les URLs
	result = fixImagePaths(result)
	
	// Nettoyer les espaces en début et fin
	result = strings.TrimSpace(result)
	
	// Ajouter un titre si le contenu n'en a pas
	if !strings.HasPrefix(result, "#") {
		result = "# Walkthrough\n\n" + result
	}
	
	return result
}

// fixImagePaths corrige les chemins d'images avec des espaces en les encodant
func fixImagePaths(markdown string) string {
	// Pattern pour détecter les images Markdown : ![alt](url)
	lines := strings.Split(markdown, "\n")
	for i, line := range lines {
		// Vérifier si la ligne contient une image Markdown
		if strings.Contains(line, "![") && strings.Contains(line, "](") {
			// Extraire l'URL de l'image
			startIdx := strings.Index(line, "](")
			if startIdx != -1 {
				startIdx += 2
				endIdx := strings.Index(line[startIdx:], ")")
				if endIdx != -1 {
					endIdx += startIdx
					url := line[startIdx:endIdx]
					
					// Encoder les espaces dans l'URL
					encodedUrl := strings.ReplaceAll(url, " ", "%20")
					
					// Reconstruire la ligne avec l'URL encodée
					lines[i] = line[:startIdx] + encodedUrl + line[endIdx:]
				}
			}
		}
	}
	
	return strings.Join(lines, "\n")
}

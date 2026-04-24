package main

import (
	"flag"
	"fmt"
	"os"
)

type Args struct {
	moduleUrl          string
	cookies            string
	localImages        bool
	offlineWalkthrough string // Nouveau: chemin vers le répertoire contenant les HTML
}

func getArguments() Args {
	var mFlag = flag.String("m", "", "Academy Module URL to the first page.")
	var cFlag = flag.String("c", "", "Academy Cookies for authorization.")
	var imgFlag = flag.Bool("local_images", false, "Save images locally rather than referencing the URL location.")
	var walkthroughFlag = flag.String("offline-walkthrough", "", "Convert walkthroughModal from HTML files in the specified directory to Markdown.")
	
	flag.Parse()
	
	arg := Args{
		moduleUrl:          *mFlag,
		cookies:            *cFlag,
		localImages:        *imgFlag,
		offlineWalkthrough: *walkthroughFlag,
	}

	// Si l'option offline-walkthrough est utilisée, on n'a pas besoin des autres paramètres
	if arg.offlineWalkthrough != "" {
		// Vérifier que le répertoire existe
		if _, err := os.Stat(arg.offlineWalkthrough); os.IsNotExist(err) {
			fmt.Printf("Error: Directory '%s' does not exist.\n", arg.offlineWalkthrough)
			os.Exit(1)
		}
		// Mode offline, on retourne directement
		return arg
	}

	// Mode normal : vérifier les arguments requis
	if arg.moduleUrl == "" || arg.cookies == "" {
		fmt.Println("Missing required arguments for module URL and HTB Academy Cookies.")
		fmt.Println("Use -h for help, or use --offline-walkthrough for offline conversion.")
		os.Exit(1)
	}

	return arg
}

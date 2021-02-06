import plist from 'plist'
import axios from 'axios'

import parseMacho from './macho/index.js'

const prettyBytes = require('pretty-bytes')


const knownArchiveExtensions = new Set([
    'app',
    'dmg',
    // 'pkg',
    'zip',
    // 'gz',
    // 'bz2'
])

const notAppFileTypes =  new Set([
    'image',
    'text',
    'audio',
    'video'
])

const knownAppExtensions =  new Set([
    '.app',
    '.app.zip'
])

function isString( maybeString ) {
    return (typeof maybeString === 'string' || maybeString instanceof String)
}

function isValidHttpUrl( string ) {
    if ( !isString( string ) ) return false

    let url

    try {
        url = new URL(string)
    } catch (_) {
        return false
    }

    return url.protocol === "http:" || url.protocol === "https:"
}

function callWithTimeout(timeout, func) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("timeout")), timeout)
        func().then(
            response => resolve(response),
            err => reject(new Error(err))
        ).finally(() => clearTimeout(timer))
    })
}

let zip

export default class AppFilesScanner {

    constructor( {
        observableFilesArray,
        testResultStore
    } ) {
        // Files to process
        this.files = observableFilesArray

        this.testResultStore = testResultStore

        // https://gildas-lormeau.github.io/zip.js/
        zip = require('@zip.js/zip.js')

        // https://gildas-lormeau.github.io/zip.js/core-api.html#configuration
        zip.configure({
            workerScripts: true,
            // workerScripts: {
            //     inflate: ["lib/z-worker-pako.js", "pako_inflate.min.js"]
            // }
        })
    }


    isApp ( file ) {

        if ( file.type.includes('/') && notAppFileTypes.has( file.type.split('/')[0] ) ) return false

        return true
    }

    getStatusMessage () {
        // 'Drag and drop one or multiple apps'

        // return `Searching for apps at ${ file.url }`


    }

    getFileStatusMessage ( file ) {


        // CORS error - 'This page has asked not to be scanned. '

        // Status Code Error - 'This page is not loading properly. '

        // No app urls found - 'No apps found on this page. Try a different page or entering the package URL directly. You can also manually download the package then drop it on here. '

        // 'Found # apps'

        // Fetching / File Loading from drag and drop - 'Loading # apps'

        // Unzipping, archive search and Parsing - 'Processing # of #'

        // Not able to unzip - 'Unable to open package. Try a different file. '

        // No Mach-o binary found - 'Could not find Mac App data in package. Try a different package. '

        // Mach-o Parsing Error - 'Unable to scan package. Try a different one. '

        // No ARM64 Architecture found - 'This App's binary is not compatible with Apple Silicon and will only run via Rosetta 2 translation, however, software vendors will sometimes will ship separate install files for Intel and ARM instead of a single one. You can try submitting the download page link for an app and we'll scan that. '

        // ARM64 Architecture found -
        return 'This App is natively compatible with Apple Silicon!'
    }


    // async scanPageForAppUrls () {

    // }

    // async downloadArchiveFromUrl () {

    // }

    async unzipFile ( file ) {
        const fileReader = new zip.BlobReader( file.instance )//new FileReader()

        fileReader.onload = function() {

            // do something on FileReader onload
            console.log('File Read')

            file.statusMessage = '📖 Reading file'
        }

        fileReader.onerror = error => {

            // do something on FileReader onload
            console.error('File Read Error', error)

            throw new Error('File Read Error', error)
        }

        fileReader.onprogress = (data) => {
            if (data.lengthComputable) {
                const progress = parseInt( ((data.loaded / data.total) * 100), 10 );
                console.log('Read progress', progress)

                file.statusMessage = `📖 Reading file. ${ progress }% read`
            }
        }

        // console.log('fileReader', fileReader)

        // https://gildas-lormeau.github.io/zip.js/core-api.html#zip-reading
        const zipReader = new zip.ZipReader( fileReader )

        // zipReader.onprogress = console.log

        // zipReader.onerror = console.log

        const entries = await zipReader.getEntries()
            .then( entries => entries.map( entry => {
                return entry

                // return {
                //     filename: entry.filename,
                //     directory: entry.directory
                // }
            }) )
            .catch( error => {
                // console.warn('Unzip Error', error)

                return error
            })

        // console.log('entries', entries)

        if ( !Array.isArray(entries) ) {
            file.statusMessage = '❔ Could not decompress file'
            file.status = 'finished'

            throw new Error('Could not decompress file')

            // return new Error('Could not decompress file')
        }

        return entries
    }

    matchesMacho ( entry ) {
        // Skip files that are deeper than 3 folders
        if ( entry.filename.split('/').length > 4 ) return false

        // Skip folders
        if ( entry.filename.endsWith('/') ) return false

        // `${ appName }.app/Contents/MacOS/${ appName }`
        // Does this entry path match any of our wanted paths
        return [
            // `${ appName }.app/Contents/MacOS/${ appName }`
            `.app/Contents/MacOS/`
        ].some( pathToMatch => {
            return entry.filename.includes(pathToMatch)
        })
    }

    matchesRootInfo ( entry ) {
        // Skip files that are deeper than 2 folders
        if ( entry.filename.split('/').length > 3 ) return false

        // Skip folders
        if ( entry.filename.endsWith('/') ) return false

        // Does this entry path match any of our wanted paths
        return [
            // `zoom.us.app/Contents/Info.plist`
            `.app/Contents/Info.plist`,
            `.zip/Contents/Info.plist`
        ].some( pathToMatch => {
            return entry.filename.endsWith(pathToMatch)
        })
    }

    findEntries ( entries, matchersObject ) {

        const matches = {}

        // const matcherKeys = Object.keys( matchers )

        // Create a new set to store found App Names
        const appNamesInArchive = new Set()

        // Search App Names in entries
        entries.forEach( entry => {
            // Look through filename parts
            entry.filename.split('/').forEach( filenamePart => {
                if ( filenamePart.includes('.app') ) {
                    const appName = filenamePart.split('.')[0]

                    appNamesInArchive.add( appName )
                }
            } )


            for ( const key in matchersObject ) {

                // Deos it match the matcher method
                const entryMatches = matchersObject[key]( entry )

                if ( entryMatches ) {
                    // If we haven't set up an array for this key
                    // then create one
                    if ( !Array.isArray(matches[key]) ) matches[key] = []

                    // Push this entry to our matching list
                    matches[key].push( entry )
                }
            }

        } )

        return matches
    }

    async parseMachOBlob ( machOBlob, fileName ) {
        const machOFile = new File([machOBlob], fileName)

        return await parseMacho( machOFile )
    }

    classifyArchitecture () {

    }

    async submitScanInfo ({
        filename,
        appVersion,
        result,
        machoMeta,
        infoPlist
    }) {
        // Each file scanned: Filename, Type(Drop or URL), File URL, Datetime, Architectures, Mach-o Meta

        // console.log( 'this.testResultStore', this.testResultStore )

        await axios.post( this.testResultStore , {
            filename,
            appVersion,
            result,
            machoMeta: JSON.stringify( machoMeta ),
            infoPlist: JSON.stringify( infoPlist )
        }).catch(function (error) {
            console.error(error)
        })
    }

    async scanFile ( file, scanIndex ) {

        // If we've already scanned this
        // then skip
        if ( file.status === 'finished' ) return

        if ( !this.isApp( file ) ) {
            file.statusMessage = '⏭ Skipped. Not app or archive'
            file.status = 'finished'

            return
        }

        // console.log('file', file)

        await new Promise(r => setTimeout(r, 1500 * scanIndex))

        file.statusMessage = '🗃 Decompressing file'
        console.log(`Decompressing file at ${ file.size }`)

        let entries

        try {
            entries = await this.unzipFile( file )
        } catch ( Error ) {
            // console.warn( Error )

            this.submitScanInfo ({
                filename: file.name,
                appVersion: null,
                result: 'error_decompression_error',
                machoMeta: null,
                infoPlist: null
            })

            // Set status message as error
            file.statusMessage = `❔ ${ Error.message }`
            file.status = 'finished'

            return
        }

        file.statusMessage = '👀 Scanning App Files'
        console.log(`Searching entries`)

        const foundEntries = this.findEntries( entries, {
            macho: this.matchesMacho,
            rootInfo: this.matchesRootInfo
        })

        // Clean out entries now that we're done with them
        entries = undefined

        // console.log('foundEntries', foundEntries)

        // file.machOEntries = this.findMachOEntries( entries )
        file.machOEntries = foundEntries.macho

        // If no Macho files were found
        // then report and stop
        if ( file.machOEntries.length === 0 ) {
            console.log(`No Macho files found for ${file.name}`, file.machOEntries)

            this.submitScanInfo ({
                filename: file.name,
                appVersion: null,
                result: 'error_no_macho_files',
                machoMeta: null,
                infoPlist: null
            })

            file.statusMessage = `❔ Unkown app format`
            file.status = 'finished'

            return
        }

        // Warn if Info.plist doesn't look right
        if ( foundEntries.rootInfo.length > 1) {
            console.warn('More than one root Info.plist found', foundEntries.rootInfo)
        } else if ( foundEntries.rootInfo.length === 0 ) {
            console.warn('No root Info.plist found', foundEntries.rootInfo)
        }

        // Break out root entry into a variable
        const [ rootInfoEntry ] = foundEntries.rootInfo

        // Get blob data from zip
        // https://gildas-lormeau.github.io/zip.js/core-api.html#zip-entry
        const infoXml = await rootInfoEntry.getData(
            // writer
            // https://gildas-lormeau.github.io/zip.js/core-api.html#zip-writing
            new zip.TextWriter(),
            // options
            {
                useWebWorkers: true,
                // onprogress: (index, max) => {

                //     const percentageNumber = (index / max * 100)
                //     // onprogress callback
                //     console.log(`Writer progress ${percentageNumber}`)
                // }
            }
        )

        // Parse the Info.plist data
        const info = plist.parse( infoXml )

        // console.log('info', info)

        file.appVersion = info.CFBundleShortVersionString
        file.displayName = info.CFBundleDisplayName

        // Set details
        const detailsData = [
            [ 'Version', info.CFBundleShortVersionString ],
            [ 'Bundle Identifier', info.CFBundleIdentifier ],
            [ 'File Mime Type', file.type ],
            [ 'Copyright', info.NSHumanReadableCopyright ],
            // [ 'Version', info.CFBundleShortVersionString ],
        ]

        detailsData.forEach( ([ label, value ]) => {
            if ( !value || value.length === 0 ) return

            file.details.push({
                label,
                value,
            })
        } )

        // console.log('infoFiles', file.name, {
        //     path: rootInfoEntry.filename,
        //     info
        // })


        console.log(`Parsing Macho ${ file.machOEntries.length } files`)

        const parsedMachoEntries = await Promise.all( file.machOEntries.map( async ( machOEntry, machEntryIndex ) => {
            console.log('Parsing ', machOEntry.filename, machOEntry.uncompressedSize / 1000 )

            if ( machEntryIndex === 0 ) {
                file.displayBinarySize = prettyBytes( machOEntry.uncompressedSize )
                file.binarySize = machOEntry.uncompressedSize
            }

            // Get blob data from zip
            // https://gildas-lormeau.github.io/zip.js/core-api.html#zip-entry
            const machOBlob = await machOEntry.getData(
                // writer
                // https://gildas-lormeau.github.io/zip.js/core-api.html#zip-writing
                // new zip.TextWriter(),
                new zip.BlobWriter(),
                // options
                {
                    useWebWorkers: true,
                    // onprogress: (index, max) => {
                    //     const percentageNumber = (index / max * 100)
                    //     // onprogress callback
                    //     console.log(`Writer progress ${percentageNumber}`)
                    // }
                }
            )

            return await this.parseMachOBlob( machOBlob, file.name )
        } ) )

        // console.log('parsedMachoEntries', parsedMachoEntries)

        // file.statusMessage = `🏁 Scan Finished. ${file.machOEntries.length} Mach-o files`
        // file.statusMessage = `🏁 Scan Finished. `
        console.log(`Searching ${ parsedMachoEntries.length } binaries for architecture info`)


        let supportedBinaries = 0
        let unsupportedBinaries = 0

        // Count supported and unsupported binaries
        parsedMachoEntries.forEach( binaryEntry => {
            const armBinary = binaryEntry.architectures.find( architecture => {
                if ( architecture.processorType === 0 ) return false

                return architecture.processorType.toLowerCase().includes('arm')
            })

            if ( armBinary !== undefined ) {
                supportedBinaries++
            } else {
                unsupportedBinaries++
            }
        } )

        console.log(`Found ${ supportedBinaries } supportedBinaries and ${unsupportedBinaries} unsupportedBinaries`)

        // console.log('supportedBinaries', supportedBinaries)
        // console.log('unsupportedBinaries', unsupportedBinaries)

        if (supportedBinaries !== 0 && unsupportedBinaries !== 0) {
            file.statusMessage = `🔶 App has some support. `
        } else if ( unsupportedBinaries !== 0 ) {
            file.statusMessage = `🔶 This app file is not natively compatible with Apple Silicon and may only run via Rosetta 2 translation, however, software vendors will sometimes will ship separate install files for Intel and ARM instead of a single one. `
        } else if ( supportedBinaries !== 0 ) {
            file.statusMessage = '✅ This app is natively compatible with Apple Silicon!'

            // Shift this scan to the top
            this.files.unshift( this.files.splice( scanIndex, 1 )[0] )
        }

        // console.log('parsedMachoEntries', JSON.parse( JSON.stringify(parsedMachoEntries) ))
        console.log( 'parsedMachoEntries', parsedMachoEntries )

        this.submitScanInfo ({
            filename: file.name,
            appVersion: file.appVersion,
            result: file.statusMessage,
            machoMeta: parsedMachoEntries.map( machoMeta => {

                const architectures = machoMeta.architectures.map( architecture => {
                    return {
                        bits: architecture.bits,
                        fileType: architecture.fileType,
                        header: architecture.header,
                        loadCommandsInfo: architecture.loadCommandsInfo,
                        magic: architecture.magic,
                        offset: architecture.offset,
                        processorSubType: architecture.processorSubType,
                        processorType: architecture.processorType,
                    }
                })

                return {
                    ...machoMeta,
                    file: undefined, // Remove file
                    architectures
                }
            }),
            infoPlist: info
        })

        file.status = 'finished'

        return
    }

    async scan ( fileList ) {

        // Push files to our files array
        Array.from(fileList).forEach( (fileInstance, scanIndex) => {
            this.files.unshift( {
                status: 'loaded',
                displayName: null,
                statusMessage: '⏳ File Loaded and Queud',
                details: [],
                appVersion: null,
                displayAppSize: prettyBytes( fileInstance.size ),
                displayBinarySize: null,
                binarySize: null,

                name: fileInstance.name,
                size: fileInstance.size,
                type: fileList.item( scanIndex ).type,
                lastModifiedDate: fileInstance.lastModifiedDate,
                instance: fileInstance,
                item: fileList.item( scanIndex )
            } )
        })

        const scanTimeoutSeconds = 30

        // Scan for archives
        await Promise.all( this.files.map( ( file, scanIndex ) => {
            return new Promise( (resolve, reject) => {

                const timer = setTimeout(() => {
                    file.statusMessage = '❔ Scan timed out'
                    file.status = 'finished'

                    reject(new Error('Scan timed out'))
                }, scanTimeoutSeconds * 1000)

                this.scanFile( file, scanIndex ).then(
                    response => resolve(response),
                    err => reject(new Error(err))
                ).finally(() => clearTimeout(timer))
            })
        }))


        // Go through and set all files to finished to clean up any straglers
        this.files.forEach( file => {
            file.status = 'finished'
        })


        return
    }

}

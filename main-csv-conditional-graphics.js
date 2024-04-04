const INPUT_TYPE = "csv";
const OUTPUT_BASE_NAME_KEY = '_CONDITIONAL_GRAPHICS_BASE_NAME';

inputCsv.addEventListener("change", function (ev) {
    uploadTelemetryFile(ev.currentTarget.files, 'csv');
}, false);

function getConfigFromForm() {
    // Get form values
    const config = {};

    config.outputBaseName = document.getElementById('output-base-name').value;
    config.layoutGrid = document.getElementById('layoutGrid').value.split(',');
    config.imageSize = document.getElementById('imageSize').value.split(',');

    return config;
}

function uploadTelemetryFile(files) {
    initDomainObjects();
    let readers = [];
    let filenames = [];

    // Abort if there were no files selected
    if (!files.length) return;

    // Store promises in array
    for (let i = 0; i < files.length; i++) {
        filenames.push(files[i].name);
        readers.push(readFileAsText(files[i]));
    }

    // Trigger Promises
    Promise.all(readers).then((values) => {
        // Values will be an array that contains an item
        // with the text of every selected file
        // ["File1 Content", "File2 Content" ... "FileN Content"]
        parseCSVTelemetry(values[0]);
    });
}

function parseCSVTelemetry(csv) {
    /*
    arrRowObjs: array of Condition objects with these properties:
    [{
        imageId: string that defines unique images. Allows more than one image to be overlayed, with different Condition Sets for each
        desc: not used
        datasSource: full path to datasource
        dataSourceToEval: this | any | all TODO: make sure Condition Set creator can properly add a discrete telem point
        condEvaluator: equalTo, notEqualTo, between, etc.
        condVals: either single string or number, or comma-sepped same
        condOutputString: output string for a given Condition
        colorBg
        colorFg
        colorBorder
        imageUrl
        condWidgetUsesOutputAsLabel: boolean
    }]
    */

    // array of objects
    arrRowObjs = csvToObjArray(csv);

    config = getConfigFromForm();

    // Create the root folder
    folderRoot = new Obj(config.outputBaseName, 'folder', true);
    root.addJson(folderRoot);
    objJson.rootId = folderRoot.identifier.key;

    // Create a Display Layout for the conditional image and add it to the root folder
    let dlCondImage = new DisplayLayout({
        'name': 'DL '.concat(config.outputBaseName),
        'layoutGrid': [parseInt(config.layoutGrid[0]), parseInt(config.layoutGrid[1])],
    });
    root.addJson(dlCondImage);
    folderRoot.addToComposition(dlCondImage.identifier.key);
    dlCondImage.setLocation(folderRoot);

    outputMsg('Condition-driven Image CSV imported, '
        .concat(arrRowObjs.length.toString())
        .concat(' rows found')
    );

    let curConditionSet;
    let dataSources = [];
    let dataSourceObj = {};
    let imageViewNames = [];
    let imageViewObjs = {}; // Tracks created image view objects, keyed by name

    for (const rowObj of arrRowObjs) {
        // let curDataSourceName;
        let curImageViewObj;
        let addDataSourceToConditionSet = false;

        rowObj.url = rowObj.imageUrl.replaceAll('~', '/');

        /***************************** IMAGE VIEW */
        if (imageViewNames.includes(rowObj.imageViewName)) {
            // We've already created this imageview object, retrieve and make that the current one.
            curImageViewObj = imageViewObjs[rowObj.imageViewName];
        } else {
            // Create a new image view and add it to dlCondImage composition.
            curImageViewObj = dlCondImage.addImageView(
                {
                    x: 0,
                    y: 0,
                    width: displayLayoutConvertPxToGridUnits(parseInt(config.layoutGrid[0]), parseInt(config.imageSize[0])),
                    height: displayLayoutConvertPxToGridUnits(parseInt(config.layoutGrid[1]), parseInt(config.imageSize[1])),
                    url: rowObj.url
                }
            );
            imageViewNames.push(rowObj.imageViewName);
            imageViewObjs[rowObj.imageViewName] = curImageViewObj;
        }

        /***************************** DATASOURCE */
        if (rowObj.dataSource) {
            if (rowObj.dataSource.includes('~')) {
                // It's a parameter
                dataSourceObj.type = 'parameter';
                dataSourceObj.name = rowObj.dataSource;
                dataSourceObj.metadata = rowObj.metadata = 'value';
                if (!dataSources.includes(dataSourceObj.name)) {
                    dataSourceObj.id = dataSourceObj.name;
                    dataSources[dataSourceObj.name] = dataSourceObj;
                    addDataSourceToConditionSet = true;
                }
            } else if (rowObj.dataSource.includes('{')) {
                // It's a new SWG
                dataSourceObj.type = 'swg';
                const o = JSON.parse(rowObj.dataSource);
                dataSourceObj.name = Object.keys(o)[0];
                dataSourceObj.props = o[dataSourceObj.name];
                dataSourceObj.metadata = rowObj.metadata = dataSourceObj.props.metadata;
                if (!dataSources.includes(dataSourceObj.name)) {
                    const swgObj = new SineWaveGenerator(dataSourceObj.name, {
                        'period': dataSourceObj.props.period,
                        'amplitude': dataSourceObj.props.amplitude,
                        'dataRateInHz': dataSourceObj.props.dataRateInHz,
                        'offset': dataSourceObj.props.offset
                    })
                    dataSourceObj.id = swgObj.identifier.key;
                    root.addJson(swgObj);
                    folderRoot.addToComposition(swgObj.identifier.key);
                    swgObj.setLocation(folderRoot);
                    dataSources[dataSourceObj.name] = dataSourceObj;
                    addDataSourceToConditionSet = true;
                }
            } else {
                // It's a SWG reference, assume it has been created
                if (Object.keys(dataSources).includes(rowObj.dataSource)) {
                    dataSourceObj = dataSources[rowObj.dataSource]; // This should retrieve name, id, metadata, and props for an SWG
                    dataSourceObj.type = 'swg';
                    rowObj.metadata = dataSourceObj.metadata;
                } else {
                    console.log('Reference for '
                        .concat(rowObj.dataSource)
                        .concat(' has not been created.'));
                }
            }
        }

        /***************************** CONDITION SET */
        if (rowObj.operation) {
            // If condition props are defined for this row, create a condition and add it by ID as part of a styles obj
            // i.e. rowObj.conditionId
            if (!curConditionSet) {
                // Make a Condition Set using the provided parameters
                curConditionSet = new ConditionSet({
                    'name': 'CS '.concat(config.outputBaseName),
                    'dataSource': dataSourceObj.id
                });

                // Add the CS to folderRoot compositions
                // Set location of the CS to folderRoot
                root.addJson(curConditionSet);
                folderRoot.addToComposition(curConditionSet.identifier.key);
                curConditionSet.setLocation(folderRoot);

                // The datasource has already been added to the CS, don't add it again
                addDataSourceToConditionSet = false;

                // Add the conditionSetIdentifier to the current image view's objectStyles collection
                dlCondImage.configuration.objectStyles[curImageViewObj.id].conditionSetIdentifier = createIdentifier(curConditionSet.identifier.key);
            }

            if (addDataSourceToConditionSet) {
                // If addDataSourceToConditionSet then add to the curConditionSet's composition
                curConditionSet.addToComposition(dataSourceObj.id);
            }

            // Create a new condition and add it to curConditionSet
            const curCondition = createConditionFromObj(rowObj);
            curConditionSet.configuration.conditionCollection.push(curCondition);

            /***************************** CONDITIONAL STYLING */
            // Add a style object to the current image view
            let conditionStyleObj = createStyleObj(rowObj);
            conditionStyleObj.conditionId = curCondition.id
            dlCondImage.configuration.objectStyles[curImageViewObj.id].styles.push(conditionStyleObj);
        }
    }

    console.log('dataSources', dataSources);

    outputJSON();
}

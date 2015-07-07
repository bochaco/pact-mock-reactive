var NULL = "NULL",
    escapeMetaCharacters = function (string) {
        return string.replace(/\$/g, '\\uff04').replace(/\./g, '\\uff0E');
    },
    unescapeMetaCharacters = function (string) {
        return string.replace(/\uff04/g, '$').replace(/\uff0E/g, '.');
    },
    Interactions = new Mongo.Collection('interactions', {
        transform: function (doc) {
            //workaround for dots in the keys (problem with mongo)
            doc.interaction = JSON.parse(unescapeMetaCharacters(JSON.stringify(doc.interaction)));
            return doc;
        }
    });

Meteor.startup(function () {
    // code to run on server at startup
    return;
});

var pathNpm = Npm.require('path'),
    appRoot = pathNpm.resolve('.');
// find better way
appRoot = appRoot.indexOf('.meteor') >= 0 ? appRoot.substring(0, appRoot.indexOf('.meteor')) : appRoot;

var fs = Npm.require('fs'),
    normalizeConsumerProvider = function (req) {
        req.headers['x-pact-consumer'] = req.headers['x-pact-consumer'] || 'NULL';
        req.headers['x-pact-provider'] = req.headers['x-pact-provider'] || 'NULL';
    },
    deleteInteractions = function (req) {
        var consumerName = req.headers['x-pact-consumer'],
            providerName = req.headers['x-pact-provider'];

        Interactions.remove({
            $or: [ {consumer: consumerName}, {provider: providerName}, {expected: 0} ]
        });
    },
    insertInteraction = function (consumerName, providerName, interaction, expected, count) {
        //workaround for dots in the keys (problem with mongo)
        interaction = JSON.parse(escapeMetaCharacters(JSON.stringify(interaction)));
        Interactions.insert({
            consumer: consumerName,
            provider: providerName,
            expected: expected,
            count: count,
            disabled: false,
            interaction: interaction
        });
    },
    findInteraction = function (interaction, successCallback, errorCallback, selector) {
        var method = interaction.method,
            path = interaction.path,
            query = interaction.query || {},
            headers = interaction.headers || {},
            body = interaction.body || {},
            mergedSelector = _.defaults(selector || {}, {
                expected: { $gt: 0 },
                'interaction.request.method': method.toLowerCase(),
                'interaction.request.path': path,
                disabled: false
            }),
            selectedInteraction,
            interactionDiffs = [],
            innerErr;

        _.each(Interactions.find(mergedSelector).fetch(), function (matchingInteraction) {
            innerErr = [];
            // compare headers of actual and expected
            // iterate thru expected headers to make sure it's in the actual header
            _.each(matchingInteraction.interaction.request.headers, function (value, key) {
                var actualHdr = headers[key], // when comparing headers defined in the pact interaction
                    actualHdrLower = headers[String(key).toLowerCase()]; // when comparing with actual HTTP headers
                if ((!actualHdr || actualHdr !== value) && (!actualHdrLower || actualHdrLower !== value)) {
                    innerErr.push({
                        'headers': {
                            'expected': { key: key, value: value },
                            'actual': { key: key, value: actualHdr }
                        }
                    });
                }
            });

            // compare query of actual and expected
            if (!_.isEqual(matchingInteraction.interaction.request.query || {}, query || {})) {
                innerErr.push({
                    'query': {
                        'expected': matchingInteraction.interaction.request.query,
                        'actual': query
                    }
                });
            }

            // compare body of actual and expected
            if (!_.isEqual(matchingInteraction.interaction.request.body || {}, body || {})) {
                innerErr.push({
                    'body': {
                        'expected': matchingInteraction.interaction.request.body,
                        'actual': body
                    }
                });
            }
            if (innerErr.length === 0) {
                selectedInteraction = matchingInteraction;
            } else {
                interactionDiffs.push(innerErr);
            }
        });
        if (selectedInteraction) {
            successCallback(selectedInteraction);
        } else {
            errorCallback({
                'message': 'No interaction found for ' + method + ' ' + path + ' ' + JSON.stringify(query),
                'interaction_diffs': interactionDiffs
            });
        }
    },
    registerInteractions = function (req, res) {
        var consumerName = req.headers['x-pact-consumer'],
            providerName = req.headers['x-pact-provider'],
            newInteractions = [],
            errors = [];

        if (req.body.interactions) {
            _.each (req.body.interactions, function(current) {
                newInteractions.push(current);
            });
            deleteInteractions(req);
        } else {
            newInteractions.push(req.body);
        }
        _.each (newInteractions, function(current) {
            var interaction = {
                    method : current.request.method,
                    path : current.request.path,
                    query : current.request.query,
                    headers : current.request.headers,
                    body : current.request.body
                },
                successCallback = function (matchingInteraction) {
                    if (consumerName !== matchingInteraction.consumer || providerName !== matchingInteraction.provider) {
                        errors.push({
                            error: 'The interaction is already registered but against a different pair of consumer-provider',
                            interaction: current
                        });
                    } else {
                        Interactions.update({ _id: matchingInteraction._id }, { $inc: { expected: 1 } });
                    }
                },
                errorCallback = function () {
                    insertInteraction(consumerName, providerName, current, 1, 0);
                },
                areRulesOk = true;

            // make sure that the response matches any defined matching rule
            _.each (current.response.responseMatchingRules, function(value, key) {
                var fieldValue = eval(key.replace('$', 'current.response'));
                if (!fieldValue) {
                    errors.push({
                        error: 'The attribute ' + key + ' doesn\'t exist in the response object',
                        interaction: current
                    });
                    areRulesOk = false;
                } else if (value.regex) {
                    var pattern = new RegExp(value.regex);
                    if (!pattern.test(fieldValue)) {
                        errors.push({
                            error: 'The attribute ' + key + ' doesn\'t match the defined regex rule: ' + value.regex,
                            interaction: current
                        });
                        areRulesOk = false;
                    }
                }
            });

            if (areRulesOk) {
                findInteraction(interaction, successCallback, errorCallback);
            }
        });
        if (errors.length > 0) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(errors));
        } else {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('Set interactions for ' + consumerName + '-' + providerName);
        }
    },
    verifyInteractions = function (req, res) {
        var registeredReqs = Interactions.find({
                consumer: req.headers['x-pact-consumer'],
                provider: req.headers['x-pact-provider'],
                expected: {$gt: 0},
                disabled: false
            }).fetch(),
            missingReqs = _.filter(registeredReqs, function(current) { 
                return current.count < current.expected; 
            }),
            unexpectedRegisteredReqs = _.filter(registeredReqs, function(current) { 
                return current.count > current.expected; 
            }),
            unexpectedReqs = Interactions.find({ expected: 0 }).fetch(),
            resText;

        if (missingReqs.length === 0 && unexpectedRegisteredReqs.length === 0 && unexpectedReqs.length === 0) {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('Interactions matched');
        } else {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            resText = 'Actual interactions do not match expected interactions.\n';
            if (missingReqs.length > 0) {
                resText += '\nMissing requests:\n';
                _.each(missingReqs, function (element) {
                    resText += '\t' + element.consumer + '-' + element.provider + ': ';
                    resText += element.interaction.request.method.toUpperCase() + ' ';
                    resText += element.interaction.request.path;
                    resText += ' (' + (element.expected - element.count) + ' missing request/s)\n';
                });
            }
            if (unexpectedRegisteredReqs.length > 0) {
                resText += '\nRegistered but unexpected number of requests:\n';
                _.each(unexpectedRegisteredReqs, function (element) {
                    resText += '\t' + element.consumer + '-' + element.provider + ': ';
                    resText += element.interaction.request.method.toUpperCase() + ' ';
                    resText += element.interaction.request.path;
                    resText += ' (' + (element.count - element.expected) + ' unexpected request/s)\n';
                });
            }
            if (unexpectedReqs.length > 0) {
                resText += '\nUnexpected requests:\n';
                _.each(unexpectedReqs, function (element) {
                    resText += '\t' + element.consumer + '-' + element.provider + ': ';
                    resText += element.interaction.request.method.toUpperCase() + ' ';
                    resText += element.interaction.request.path;
                    resText += ' (' + element.count + ' unexpected request/s)\n';
                });
            }
            res.end(resText);
        }
    },
    createPact = function (consumer, provider) {
        var interactions = Interactions.find({
                $or : [ {consumer: consumer} , {consumer: NULL} ],
                $or : [ {provider: provider} , {provider: NULL} ],
                disabled: false
            }).fetch(),
            pact = {
                consumer: {
                    name: consumer
                },
                provider: {
                    name: provider
                },
                interactions: [],
                metadata: {
                    "pact-specification": {
                        version: '2.0.0'
                    },
                    "pact-mock-reactive": {
                        version: '0.1.0'
                    }
                }
            };

        _.each(interactions, function (element) {
            pact.interactions.push(element.interaction);
        });

        return pact;
    },
    writePact = function (req, res) {
        if (req.body.consumer && req.body.consumer.name && req.body.provider && req.body.provider.name) {
            var pact = createPact(req.body.consumer.name, req.body.provider.name),
                filename = (req.body.consumer.name.toLowerCase() + '-' + req.body.provider.name.toLowerCase()).replace(/\s/g, '_'),
                pactsDir = process.env.PACTS_DIR || appRoot + 'pacts',
                path = pactsDir + '/' + filename + '.json';
            fs.writeFile(path, JSON.stringify(pact, null, 2), function (err) {
                if (err) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ 'message': 'Error ocurred in mock service: RuntimeError - pact file couldn\'t be saved' }));
                } else {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(pact));
                }
            });
        } else {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 'message': 'Error ocurred in mock service: RuntimeError - You must specify a consumer and provider name' }));
        }
    },
    requestsHandler = function (method, path, query, req, res) {
        var interaction = {
                method : method,
                path : path,
                query : query,
                headers : req.headers,
                body : req.body
            },
            successCallback = function (selectedInteraction) {
                var expectedResponse = selectedInteraction.interaction.response;
                Interactions.update({ _id: selectedInteraction._id }, { $inc: { count: 1 } });
                res.writeHead(expectedResponse.status, expectedResponse.headers);
                if (expectedResponse.headers && expectedResponse.headers["Content-Type"] === "application/xml") {
                    res.end(expectedResponse.body);
                } else {
                    res.end(JSON.stringify(expectedResponse.body));
                }
            },
            errorCallback = function (err) {
                // this is an unexpected interaction, verify if it has happened before
                var innerSuccessCallback = function (selectedInteraction) {
                        Interactions.update({ _id: selectedInteraction._id }, { $inc: { count: 1 } });
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify(err));
                    },
                    innerErrorCallback = function () {
                        insertInteraction(NULL, NULL, {
                            request: {
                                method: method.toLowerCase(),
                                path: path,
                                query: query,
                                headers: req.headers,
                                body: req.body
                            },
                            reponse: {}
                        }, 0, 1);
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify(err));
                    },
                    selector = {
                        expected: 0
                    };
                findInteraction(interaction, innerSuccessCallback, innerErrorCallback, selector);
            };
        findInteraction(interaction, successCallback, errorCallback);
    },
    routeInteractions = function (route) {
        var headers = route.request.headers;
        if (headers['x-pact-mock-service'] === 'true') {
            registerInteractions(route.request, route.response);
        } else {
            requestsHandler(route.method, route.url, route.params.query, route.request, route.response);
        }
    },
    routePact = function (route) {
        var headers = route.request.headers;
        if (headers['x-pact-mock-service'] === 'true') {
            writePact(route.request, route.response);
        } else {
            requestsHandler(route.method, route.url, route.params.query, route.request, route.response);
        }
    };

Router.onBeforeAction(Iron.Router.bodyParser.text({
    "type": "application/xml"
}));	
	
Router.route('/interactions', { where: 'server' })
    .post(function () {
        normalizeConsumerProvider(this.request);
        routeInteractions(this);
    })
        .put(function () {
        normalizeConsumerProvider(this.request);
        routeInteractions(this);
    })
    .delete(function () {
        var headers = this.request.headers;
        if (headers['x-pact-mock-service'] === 'true') {
            normalizeConsumerProvider(this.request);
            deleteInteractions(this.request);
            this.response.writeHead(200, { 'Content-Type': 'text/plain' });
            this.response.end('Deleted interactions');
        } else {
            requestsHandler(this.method, this.url, this.params.query, this.request, this.response);
        }
    });

Router.route('/interactions/verification', { where: 'server' })
    .get(function () {
        var headers = this.request.headers;
        if (headers['x-pact-mock-service'] === 'true') {
            normalizeConsumerProvider(this.request);
            verifyInteractions(this.request, this.response);
        } else {
            requestsHandler(this.method, this.url, this.params.query, this.request, this.response);
        }
    });

Router.route('/pact', { where: 'server' })
    .post(function () {
        routePact(this);
    })
        .put(function () {
        routePact(this);
    });

Router.route('(.+)', function () {
    if (this.url === '/favicon.ico') {
        this.response.writeHead(200, { 'Content-Type': 'application/json' });
        this.response.end();
    } else {
		debugger;
        requestsHandler(this.method, '/' + this.params, this.params.query, this.request, this.response);
    }
}, { where: 'server' });

Meteor.methods({
    resetInteractions: function () {
        Interactions.update({ expected: { $gt: 0 } }, { $set : { count: 0 } }, { multi: true });
        Interactions.remove({ expected: 0 });
    },
    clearInteractions: function () {
        Interactions.remove({});
    },
    addInteraction: function (consumer, provider, interaction) {
        if (!consumer || !consumer.length) {
            consumer = NULL;
        }
        if (!provider || !provider.length) {
            provider = NULL;
        }        
        var selector = {
                method : interaction.request.method,
                path : interaction.request.path,
                query : interaction.request.query,
                headers : interaction.request.headers,
                body : interaction.request.body
            },
            successCallback = function (matchingInteraction) {
                if (consumer === matchingInteraction.consumer && provider === matchingInteraction.provider) {
                    Interactions.update({ _id: matchingInteraction._id }, { $inc: { expected: 1 } });
                }
            },
            errorCallback = function () {
                insertInteraction(consumer, provider, interaction, 1, 0);
            };
        findInteraction(selector, successCallback, errorCallback);
    },
    writePacts: function (pairs) {
        var res = {};
        _.each(pairs, function (p) {
            writePact(p, res);
        });
    }
});

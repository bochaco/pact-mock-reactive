var escapeMetaCharacters = function (string) {
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
    deleteInteractions = function (req) {
        var consumerName = req.headers['x-pact-consumer'],
            providerName = req.headers['x-pact-provider'];

        Interactions.remove({consumer: consumerName, provider: providerName});
    },
    insertInteraction = function (consumerName, providerName, interaction, count) {
        //workaround for dots in the keys (problem with mongo)
        interaction = JSON.parse(escapeMetaCharacters(JSON.stringify(interaction)));
        Interactions.insert({
            consumer: consumerName,
            provider: providerName,
            count: count || 1,
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
                'consumer': { $not: /UNEXPECTED/ },
                'provider': { $not: /UNEXPECTED/ },
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
                        Interactions.update({ _id: matchingInteraction._id }, { $inc: { count: 1 } });
                    }
                },
                errorCallback = function () {
                    insertInteraction(consumerName, providerName, current);
                };
            findInteraction(interaction, successCallback, errorCallback);
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
        var missingReqs = Interactions.find({
                consumer: req.headers['x-pact-consumer'],
                provider: req.headers['x-pact-provider'],
                count: { $gt: 0 },
                disabled: false
            }).fetch(),
            unexpectedReqs = Interactions.find({ count: { $lt: 0 }, disabled: false }).fetch(),
            resText;
        if (missingReqs.length === 0 && unexpectedReqs.length === 0) {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('Interactions matched');
        } else {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            resText = 'Actual interactions do not match expected interactions for mock MockService.\n';
            if (missingReqs.length > 0) {
                resText += '\nMissing requests:\n';
                _.each(missingReqs, function (element) {
                    resText += '\t' + element.consumer + '-' + element.provider + ': ';
                    resText += element.interaction.request.method.toUpperCase() + ' ';
                    resText += element.interaction.request.path;
                    resText += ' (' + element.count + ' missing request/s)\n';
                });
            }
            if (unexpectedReqs.length > 0) {
                resText += '\nUnexpected requests:\n';
                _.each(unexpectedReqs, function (element) {
                    resText += '\t' + element.consumer + '-' + element.provider + ': ';
                    resText += element.interaction.request.method.toUpperCase() + ' ';
                    resText += element.interaction.request.path;
                    resText += ' (' + (-1 * element.count) + ' unexpected request/s)\n';
                });
            }
            res.end(resText);
        }
    },
    createPact = function (consumer, provider) {
        var interactions = Interactions.find({
                consumer: consumer,
                provider: provider,
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
                    pactSpecificationVersion: '1.0.0'
                }
            };

        _.each(interactions, function (element) {
            pact.interactions.push(element.interaction);
        });

        return pact;
    },
    writePact = function (req, res) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        if (req.body.consumer && req.body.consumer.name && req.body.provider && req.body.provider.name) {
            var pact = createPact(req.body.consumer.name, req.body.provider.name),
                filename = (req.body.consumer.name.toLowerCase() + '-' + req.body.provider.name.toLowerCase()).replace(/\s/g, '_'),
                path = appRoot + 'pacts/' + filename + '.json';
            fs.writeFile(path, JSON.stringify(pact, null, 2), function (err) {
                if (err) {
                    res.end(JSON.stringify({ 'message': 'Error ocurred in mock service: RuntimeError - pact file couldn\'t be saved' }));
                } else {
                    res.end(JSON.stringify(pact));
                }
            });
        } else {
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
                Interactions.update({ _id: selectedInteraction._id }, { $inc: { count: -1 } });
                res.writeHead(expectedResponse.status, expectedResponse.headers);
                if (expectedResponse.headers && expectedResponse.headers["Content-Type"] === "application/xml") {
                    res.end(expectedResponse.body);
                } else {
                    res.end(JSON.stringify(expectedResponse.body));
                }
            },
            errorCallback = function (err) {
                // this is an unexpected interaction, verify if it has happened before
                var UNEXPECTED = 'UNEXPECTED',
                    innerSuccessCallback = function (selectedInteraction) {
                        Interactions.update({ _id: selectedInteraction._id }, { $inc: { count: -1 } });
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify(err));
                    },
                    innerErrorCallback = function () {
                        insertInteraction(UNEXPECTED, UNEXPECTED, {
                            request: {
                                method: method.toLowerCase(),
                                path: path,
                                query: query,
                                headers: req.headers,
                                body: req.body
                            },
                            reponse: {}
                        }, -1);
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify(err));
                    },
                    selector = {
                        'consumer': UNEXPECTED,
                        'provider': UNEXPECTED
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

Router.route('/interactions', { where: 'server' })
    .post(function () {
        routeInteractions(this);
    })
        .put(function () {
        routeInteractions(this);
    })
    .delete(function () {
        var headers = this.request.headers;
        if (headers['x-pact-mock-service'] === 'true') {
            deleteInteractions(this.request);
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('Deleted interactions');
        } else {
            requestsHandler(this.method, this.url, this.params.query, this.request, this.response);
        }
    });

Router.route('/interactions/verification', { where: 'server' })
    .get(function () {
        var headers = this.request.headers;
        if (headers['x-pact-mock-service'] === 'true') {
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
        requestsHandler(this.method, '/' + this.params, this.params.query, this.request, this.response);
    }
}, { where: 'server' });

Meteor.methods({
    resetInteractions: function () {
        Interactions.update({ count: { $gte: 0 } }, { $set : { count: 1 } }, { multi: true });
        Interactions.remove({ count: { $lt: 0 } });
    },
    clearInteractions: function () {
        Interactions.remove({});
    },
    addInteraction: function (consumer, provider, interaction) {
        var selector = {
                method : interaction.request.method,
                path : interaction.request.path,
                query : interaction.request.query,
                headers : interaction.request.headers,
                body : interaction.request.body
            },
            successCallback = function (matchingInteraction) {
                if (consumer === matchingInteraction.consumer && provider === matchingInteraction.provider) {
                    Interactions.update({ _id: matchingInteraction._id }, { $inc: { count: 1 } });
                }
            },
            errorCallback = function () {
                insertInteraction(consumer, provider, interaction);
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

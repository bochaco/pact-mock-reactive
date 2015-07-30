# Pact Mock with a Reactive UI

This codebase provider a mock service which can be used with implementations of [Pact][pact]. Apart from its backend service, it also exposes a reactive Web based UI where all the activity related to registering y verifying Pact interactions are displayed in real time. 

This mock service is implemented as a [Meteor][meteor] stand alone application, and it works on Linux and Windows (OS X not tested but it should also work) platforms.

This mock service was inspired by the Ruby [pack-mock_service][pack-mock_service] gem, but having the following additional features in mind as the main objective and differentiator:
* Reactive Web based UI where the current state of the mock service and registered interactions can be seen in real time
* Web based UI that can be useful and helpful at the moment of creating the consumer's tests during the software development phase
* Support Pact specification v2.0 which includes the use of regex for matching rules in either the requests and responses
* Support for registering interactions for more than one consumer-provider pair
* Ability of registering the same interaction for the same consumer-provider pair more than once

The mock service provides the following HTTP endpoints in the backend:

* DELETE /interactions - clear previously mocked interactions
* POST & PUT /interactions - set up an expected interaction
* GET /interactions/verification - determine whether the expected interactions have taken place
* POST /pact - write the pact file

**Note that pact file format is compatible with [Pact JVM][pact-jvm].**

As the Pact mock service can be used as a standalone executable and administered via HTTP, it can be used for testing with any language. All that is required is a library in the native language to create the HTTP calls listed above. Currently there are binding for [Ruby][pact] and [Javascript][javascript].

Additionally, this mock service provides the following features in the frontend Web based UI, displaying the information in real time as the backend endpoints are exercised:

* View the list of registered interactions
* View the number of expected vs. received requests for each of the registered interactions
* Individually disable/enable, delete and increment/decrement the number of expected requests for each of the registered interactions
* View the list of Pact interactions for each consumer-provider pairs (displayed in JSON formst just like they are written to disk)
* Import a Pact file to automatically register all interaction extracted from the file
* Manually add/register interactions
* Delete all interactions
* Reset the counters of received requests

## Usage

1. Install [Meteor][meteor-install]
2. Clone this repository
```
  $ git clone https://github.com/bochaco/pact-mock-reactive
```
3. Run the application
```
  $ cd pact-mock-reactive
  $ meteor run
```
4. Open your web browser and go to http://localhost:3000 to see the frontend UI:

## Interactions for multiple consumer-provider pairs

As mentioned above, this Pact mock service can be used as a standalone executable and administered via HTTP, it can be used for testing with any language. All that is required is a library in the native language to create the HTTP calls listed above. Currently there are binding for [Ruby][pact] and [Javascript][javascript], this mock service is compatible with any of them.

However, the mentioned bindings do not support registration of interactions for more than one consumer-provider pair against a single mock service instance. This is why a [branch of the Javascript][javascript-branch] binding was created to add such a support for multiple consumer-provider against  single instance of this mock service.

In order to support multiple consumer-provider pairs, all that is required is to send the consumer and provider names as headers of each HTTP request sent to the mock service, e.g.:
```
X-Pact-Consumer: ConsumerService
X-Pact_Provider: ProviderService
```
The Web based UI will display the list of interaction showing the consumer and provider eacho of them is registered for. Additionally, the mock service will write a separate pact file containig the interactions of each consumer-provider pair.

## Contributing

Coming soon...

[pact]: https://github.com/realestate-com-au/pact
[javascript]: https://github.com/DiUS/pact-consumer-js-dsl
[meteor]: http://www.meteor.com
[meteor-install]: https://www.meteor.com/install
[pack-mock_service]: https://github.com/bethesque/pact-mock_service
[pact-jvm]: https://github.com/DiUS/pact-jvm
[javascript-branch]: https://github.com/bochaco/pact-consumer-js-dsl

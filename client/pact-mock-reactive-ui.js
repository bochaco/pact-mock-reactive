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
    }),
    pactsTree = function (obj, level) {
      var str = "",
          tabs = Array(3*level).join("&nbsp;");

      _.each (obj, function (value, key) {
        if (typeof value === 'undefined' || value === null) {
          str += tabs + "\"" + key + "\"<span class='black'> : null</span><br/>";
        } else if (Array.isArray(value)) {
          str += tabs + "\"" + key + "\"<span class='black'> : [</span><br/>";
          for (i in value) {
            str += tabs + tabs + "<span class='black'>{</span><br/>";
            str += pactsTree(value[i], 2 + level);
            str += tabs + tabs + "<span class='black'>}</span><br/>";
          }
          str += tabs + "<span class='black'>]</span><br/>";
        } else if (typeof value === 'object') {
          str += tabs + "\"" + key + "\"<span class='black'> : {</span><br/>";
          str += pactsTree(value, 1 + level);
          str += tabs + "<span class='black'>}</span><br/>";
        } else {
          str += tabs + "\"" + key + "\"<span class='black'> : </span>\"" + value + "\"<br/>";
        }
      });

      return str;
    };

Router.route('/', function () {});

Meteor.startup(function () {
  // code to run on client at startup
  $('.ui.accordion').accordion({exclusive: false});
  $('.ui.long.modal')
      .modal('setting', 'transition', 'fade down')
      .modal('setting', 'can fit', 'true');
});

Template.body.helpers({
  interactions: function () {
    return Interactions.find();
  },
  interactionsHelper: function () {
    return JSON.stringify(Interactions.find().fetch());
  },
  pacts: function () {
    var str = "",
        pact;
    var interactions = Interactions.find({
            disabled: false
        }).fetch(),

    pairs = _.groupBy(interactions, function (element) {
                return element.consumer + "-" + element.provider;
            });

    _.each(pairs, function (value, key) {
      str += "<span class='black'>" + key.toLowerCase().replace(/\s/g, '_') + ".json:</span><br/>";
      pact = {
          consumer: {
              name: value[0].consumer
          },
          provider: {
              name: value[0].provider
          },
          interactions: [],
          metadata: {
            pactSpecificationVersion: '1.0.0'
          }
      };

      _.each(value, function (element) {
          pact.interactions.push(element.interaction);
      });

      str += "<span class='black'>{</span><br/>";
      str += pactsTree(pact, 1);
      str += "<span class='black'>}</span><br/><br/>";
    });

    return str;
  }
});

Template.body.events({
  'click #resetbutton': function () {
    Meteor.call("resetInteractions");
  },
  'click #clearbutton': function () {
    Meteor.call("clearInteractions");
  },
  'click #pactsbutton': function () {
    $('.ui.modal').modal('show');
  }
});

Template.interaction.helpers({
  receivedHelper: function () {
    return this.count === 0;
  },
  countHelper: function () {
    var label = "Received";
    if (this.count > 0) {
      label = "Missing";
      if (this.count > 1) {
        label += " (" + this.count + ")";
      }
    } else if (this.count < 0) {
      label = "Unexpected";
      if (this.count < -1) {
        label += " (" + (-1 * this.count) + ")";
      }
    }
    return label;
  },
  disabledHelper: function () {
    return this.disabled;
  },
  jsonHelper: function (object, str) {
    if (object) {
      str = JSON.stringify(object);
    }
    return str;
  }
});

Template.interaction.events({
  'click #removeInteraction': function () {
    Interactions.remove(this._id);
  },
  'click #toggleInteraction': function () {
    Interactions.update({_id: this._id}, {$set: {disabled: !this.disabled} });
  }
});


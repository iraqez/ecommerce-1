define([
        'backbone',
        'backbone.validation',
        'moment',
        'pikaday',
        'underscore'],
    function (Backbone,
              BackboneValidation,
              moment,
              Pikaday,
              _) {
        'use strict';

        return {
            /**
             * Returns the attributes of a node.
             *
             * @param nodeAttributes Attributes of the node.
             * @param startsWithAndStrip Filters only attributes that start with
             *   this string and strips it off the attribute.
             * @param blackList Exclude attributes in this array of strings.
             * @returns Hash of found attributes.
             */
            getNodeProperties: function (nodeAttributes, startsWithAndStrip, blackList) {
                var properties = {};

                // fill in defaults
                startsWithAndStrip = startsWithAndStrip || '';
                blackList = blackList || [];

                _(_(nodeAttributes.length).range()).each(function (i) {
                    var nodeName = nodeAttributes.item(i).nodeName,
                        strippedName;
                    // filter the attributes to just the ones that start with our
                    // selection and aren't in our blacklist
                    if (nodeName.indexOf(startsWithAndStrip) === 0 && !_(blackList).contains(nodeName)) {
                        // remove the
                        strippedName = nodeName.replace(startsWithAndStrip, '');
                        properties[strippedName] =
                            nodeAttributes.item(i).value;
                    }
                });
                return properties;
            },

            /**
             * Strips the timezone component from a datetime string.
             *
             * Input is assumed to be in UTC timezone. Output datetime is formatted as
             * ISO 8601 without the timezone component.
             *
             * @param {String} datetime - String representing a UTC datetime
             * @returns {String}
             */
            stripTimezone: function (datetime) {
                if (datetime) {
                    datetime = moment.utc(new Date(datetime)).format('YYYY-MM-DDTHH:mm:ss');
                }

                return datetime;
            },

            /**
             * Adds the UTC timezone to a given datetime string.
             *
             * Output is formatted as ISO 8601.
             *
             * @param {String} datetime - String representing a datetime WITHOUT a timezone component
             * @returns {String}
             */
            restoreTimezone: function (datetime) {
                if (datetime) {
                    datetime = moment.utc(datetime + 'Z').format();
                }
                return datetime;
            },

            /**
             * Indicates if all models in the array are valid.
             *
             * Calls isValid() on every model in the array.
             *
             * @param {Backbone.Model[]} models
             * @returns {Boolean} indicates if ALL models are valid.
             */
            areModelsValid: function (models) {
                return _.every(models, function (model) {
                    return model.isValid(true);
                });
            },

            /**
             * Bind the provided view for form validation.
             *
             * @param {Backbone.View} view
             */
            bindValidation: function (view) {
                /* istanbul ignore next */
                Backbone.Validation.bind(view, {
                    valid: function (view, attr) {
                        var $el = view.$el.find('[name=' + attr + ']'),
                            $group = $el.closest('.form-group'),
                            $helpBlock = $group.find('.help-block:first'),
                            className = 'invalid-' + attr,
                            $msg = $helpBlock.find('.' + className);

                        $msg.remove();

                        $group.removeClass('has-error');
                        $helpBlock.addClass('hidden');
                    },
                    invalid: function (view, attr, error) {
                        var $el = view.$el.find('[name=' + attr + ']'),
                            $group = $el.closest('.form-group'),
                            $helpBlock = $group.find('.help-block:first'),
                            className = 'invalid-' + attr,
                            $msg = $helpBlock.find('.' + className);

                        if (_.isEqual($msg.length, 0)) {
                            $helpBlock.append('<div class="' + className + '">' + error + '</div>');
                        } else {
                            $msg.html(error);
                        }

                        $group.addClass('has-error');
                        $helpBlock.removeClass('hidden');
                    }
                });
            },

            /**
             * Disables a given element when a given operation is running.
             * @param {jQuery} element the element to be disabled.
             * @param operation the operation during whose duration the
             * element should be disabled. The operation should return
             * a JQuery promise.
             */
            disableElementWhileRunning: function(element, operation) {
                element.addClass('is-disabled').attr('aria-disabled', true);
                return operation().always(function() {
                    element.removeClass('is-disabled').attr('aria-disabled', false);
                });
            },

            /**
             * Adds Pikaday date picker for given element in format required.
             * For now this function is required in coupon_form_view.js and
             * course_form_view.js.
             */
            addDatePicker: function(context) {
                _.each(context.$el.find('.add-pikaday'), function(el) {
                    if (el.getAttribute('datepicker-initialized') !== 'true') {
                        new Pikaday({
                            field: el,
                            format: 'YYYY-MM-DDTHH:mm:ss',
                            defaultDate: context.model.get(el.name),
                            setDefaultDate: true,
                            showTime: true,
                            use24hour: false,
                            autoClose: false
                        });
                        el.setAttribute('datepicker-initialized', 'true');
                    }
                });
            },

            /**
             * Most performant Luhn check for credit card number validity.
             * https://jsperf.com/credit-card-validator/7
             */
            isValidCardNumber: function(cardNumber) {
                var len = cardNumber.length,
                    mul = 0,
                    prodArr = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [0, 2, 4, 6, 8, 1, 3, 5, 7, 9]],
                    sum = 0;
                
                while (len--) {
                    sum += prodArr[mul][parseInt(cardNumber.charAt(len), 10)];
                    mul ^= 1;
                }
                
                return sum % 10 === 0 && sum > 0;
            },

            /**
             * Get the credit card type based on the card's number.
             *
             * @param (string) - The credit card number.
             *
             * @returns (object) - The credit card type name and coresponding 3-number CyberSource card ID.
             */
            getCreditCardType: function(cardNumber) {
                var matchers = {
                        amex: [/^3[47]\d{13}$/, '003', 4],
                        diners: [/^3(?:0[0-59]|[689]\d)\d{11}$/, '005', 3],
                        discover: [
                            /^(6011\d{2}|65\d{4}|64[4-9]\d{3}|62212[6-9]|6221[3-9]\d|622[2-8]\d{2}|6229[01]\d|62292[0-5])\d{10,13}$/,  // jshint ignore:line
                            '004', 3
                        ],
                        jcb: [/^(?:2131|1800|35\d{3})\d{11}$/, '007', 4],
                        maestro: [/^(5[06789]|6\d)[0-9]{10,17}$/, '042', 3],
                        mastercard: [/^(5[1-5]\d{2}|222[1-9]|22[3-9]\d|2[3-6]\d{2}|27[01]\d|2720)\d{12}$/, '002', 3],
                        visa: [/^(4\d{12}?(\d{3})?)$/, '001', 3]
                    };

                for (var key in matchers) {
                    if (matchers[key][0].test(cardNumber)) {
                        return {
                            'name': key,
                            'type': matchers[key][1],
                            'cvnLength': matchers[key][2]
                        };
                    }
                }
            }
        };
    }
);

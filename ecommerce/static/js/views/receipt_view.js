define([
        'jquery',
        'jquery-ajax-retry',
        'backbone',
        'underscore',
        'currency-symbol',
        'edx-ui-toolkit/utils/string-utils',
        'utils/analytics_utils',
        'js-cookie',
        'date-utils',
        'bootstrap',
        'jquery-url'
    ],
function ($, AjaxRetry, Backbone, _, Currency, StringUtils, AnalyticsUtils, Cookies) {
    'use strict';

    return Backbone.View.extend({
        orderId: null,
        el: '#receipt-container',

        events: {
          'click #credit-button': 'getCredit'
        },

        initialize: function () {
            this.orderId = this.orderId || $.url('?order_number');
            _.bindAll(this, 'renderReceipt', 'renderError', 'getProviderData', 'renderProvider');
        },

        renderReceipt: function (data) {
            var providerId;

            // Add the receipt info to the template context
            this.courseKey = this.getOrderCourseKey(data);
            this.username = this.$el.data('username');
            providerId = this.getCreditProviderId(data);
            if (providerId) {
                this.getProviderData(this.$el.data('lms-url'), providerId).then(this.renderProvider, this.renderError);
            }
            // After fully rendering the template, attach analytics click handlers
            AnalyticsUtils.instrumentClickEvents();
            // Fire analytics event that order has completed
            this.trackPurchase(data);
            return this;
        },

        getVerificationRequired: function (order) {
            var lineAttributes = order.lines[0].product.attribute_values;
            for (var i = 0; i < lineAttributes.length; i++) {
                if (lineAttributes[i].name === 'id_verification_required') {
                    return lineAttributes[i].value;
                }
            }
            return false;
        },

        renderProvider: function (context) {
            var templateHtml = $('#provider-tpl').html(),
                providerDiv = this.$el.find('#receipt-provider');
            context.course_key = this.courseKey;
            context.username = this.username;
            context.platformName = this.$el.data('platform-name');
            providerDiv.html(_.template(templateHtml)(context)).removeClass('hidden');
        },

        renderError: function () {
            // Display an error banner
            $('#error-container').removeClass('hidden');
        },

        trackPurchase: function (order) {
            AnalyticsUtils.trackingModel.trigger('segment:track', 'Completed Purchase', {
                orderId: order.number,
                total: order.total_excl_tax,
                currency: order.currency
            });
        },

        render: function () {
            var self = this;

            if (this.orderId) {
                // Get the order details
                self.$el.removeClass('hidden');
            } else {
                this.renderError();
            }
        },

        /**
         * Retrieve credit provider data from LMS.
         * @param  {string} lmsUrl The base url of the LMS instance.
         * @param  {string} providerId The providerId of the credit provider.
         * @return {object} JQuery Promise.
         */
        getProviderData: function (lmsUrl, providerId) {
            return $.ajax({
                url: StringUtils.interpolate('{lmsUrl}/api/credit/v1/providers/{providerId}/',
                    {lmsUrl: lmsUrl, providerId: providerId}),
                type: 'GET',
                dataType: 'json',
                contentType: 'application/json',
                headers: {
                    'X-CSRFToken': Cookies.get('ecommerce_csrftoken')
                }
            }).retry({times: 5, timeout: 2000, statusCodes: [404]});
        },

        /**
         * Retrieve partner data from Otto.
         * @param  {string} order The order whose partner to retrieve.
         * @return {object} JQuery Promise.
         */
        getPartnerData: function (order) {
            return $.ajax({
                url: StringUtils.interpolate('/api/v2/partners/{partnerId}/',
                    {partnerId: order.lines[0].product.stockrecords[0].partner}),
                type: 'GET',
                dataType: 'json',
                contentType: 'application/json'
            }).retry({times: 5, timeout: 2000, statusCodes: [404]});
        },

        getOrderCourseKey: function (order) {
            var length;
            length = order.lines.length;
            for (var i = 0; i < length; i++) {
                var line = order.lines[i],
                    attributeValues = _.find(line.product.attribute_values, function (attribute) {
                        // If the attribute has a 'code' property, compare its value, otherwise compare 'name'
                        var value_to_match = 'course_key';
                        if (attribute.code) {
                            return attribute.code === value_to_match;
                        } else {
                            return attribute.name === value_to_match;
                        }
                    });

                // This method assumes that all items in the order are related to a single course.
                if (attributeValues !== undefined) {
                    return attributeValues.value;
                }
            }

            return null;
        },

        /**
         * Check whether the payment is for the credit course or not.
         *
         * @param  {object} order Receipt data received from the server
         * @return {string} String of the provider_id or null.
         */
        getCreditProviderId: function (order) {
            var attributeValues,
                line = order.lines[0];
            attributeValues = _.find(line.product.attribute_values, function (attribute) {
                return attribute.name === 'credit_provider';
            });

            // This method assumes that all items in the order are related to a single course.
            if (attributeValues !== undefined) {
                return attributeValues.value;
            }

            return null;
        },

        /**
         * Completes the process of getting credit for the course.
         *
         */
        getCredit: function (event) {     // jshint ignore:line
            try {
                event.preventDefault();
            } catch (err) {
                // Ignore the error as not all event inputs have the preventDefault method.
            }
            var creditButton = $('#credit-button'),
                courseKey = creditButton.data('course-key'),
                username = creditButton.data('username'),
                providerId = creditButton.data('provider'),
                $errorContainer = $('#error-container');
            /* jshint unused:vars */
            $.ajax({
                url: StringUtils.interpolate(
                    '{lms_url}/api/credit/v1/providers/{providerId}/request/',
                    {lms_url: $('#receipt-container').data('lms-url'), providerId: providerId}
                ),
                type: 'POST',
                headers: {
                    'X-CSRFToken': Cookies.get('ecommerce_csrftoken')
                },
                dataType: 'json',
                contentType: 'application/json',
                data: JSON.stringify({
                    'course_key': courseKey,
                    'username': username
                }),
                context: this,
                success: function (requestData) {
                    var $form = $('<form>', {
                        'class': 'hidden',
                        'action': requestData.url,
                        'method': 'POST',
                        'accept-method': 'UTF-8'
                    });

                    _.each(requestData.parameters, function (value, key) {
                        $('<textarea>').attr({
                            name: key,
                            value: value
                        }).appendTo($form);
                    });

                    $form.appendTo('body').submit();
                },
                error: function (xhr, ajaxOptions, thrownError) {
                    $errorContainer.removeClass('hidden');
                }
            });
        }
    });
});     // jshint ignore:line

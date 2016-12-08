/**
 * Basket page scripts.
 **/

define([
        'jquery',
        'underscore',
        'underscore.string',
        'utils/utils',
        'js-cookie'
    ],
    function ($,
              _,
              _s,
              Utils,
              Cookies
    ) {
        'use strict';

        var appendToForm = function (value, key, form) {
            $('<input>').attr({
                type: 'text',
                name: key,
                value: value
            }).appendTo(form);
        },
        checkoutPayment = function(data) {
            $.ajax({
                url: '/api/v2/checkout/',
                method: 'POST',
                contentType: 'application/json; charset=utf-8',
                dataType: 'json',
                headers: {
                    'X-CSRFToken': Cookies.get('ecommerce_csrftoken')
                },
                data: JSON.stringify(data),
                success: onSuccess,
                error: onFail
            });
        },
        hideVoucherForm = function() {
            $('#voucher_form_container').hide();
            $('#voucher_form_link').show();
        },
        onFail = function(){
            var message = gettext('Problem occurred during checkout. Please contact support');
            $('#messages').empty().append(
                _s.sprintf('<div class="error">%s</div>', message)
            );
        },
        onSuccess = function (data) {
            var $form = $('<form>', {
                class: 'hidden',
                action: data.payment_page_url,
                method: 'POST',
                'accept-method': 'UTF-8'
            });

            _.each(data.payment_form_data, function (value, key) {
                    $('<input>').attr({
                        type: 'hidden',
                        name: key,
                        value: value
                    }).appendTo($form);
                  });

            $form.appendTo('body').submit();
        },
        cardInfoValidation = function (event) {
            var cardType,
                currentMonth = new Date().getMonth(),
                currentYear = new Date().getFullYear(),
                cardNumber = $('input[name=card_number').val(),
                cvnNumber = $('input[name=card_cvn]').val(),
                cardExpiryMonth = $('select[name=card_expiry_month]').val(),
                cardExpiryYear = $('select[name=card_expiry_year]').val();

            _.each($('.validation-error'), function(errorMsg) {
                $(errorMsg).empty();
            });
            cardType = Utils.getCreditCardType(cardNumber);

            if (!Utils.isValidCardNumber(cardNumber)) {
                $('#div_id_card_number .validation-error').append('<span>Invalid card number</span>');
                event.preventDefault();
            } else if (typeof cardType === 'undefined') {
                $('#div_id_card_number .validation-error').append('<span>Unsupported card type</span>');
                event.preventDefault();
            } else if ( cvnNumber.length !== cardType.cvnLength) {
                $('#div_id_card_cvn .validation-error').append('<span>Wrong CVN length</span>');
                event.preventDefault();
            }

            if (Number(cardExpiryMonth) > 12 || Number(cardExpiryMonth) < 1) {
                $('#div_id_card_expiration_month .validation-error').append('<span>Invalid month</span>');
                event.preventDefault();
            } else if (Number(cardExpiryYear) < currentYear) {
                $('#div_id_card_expiration_year .validation-error').append('<span>Invalid year</span>');
                event.preventDefault();
            } else if (Number(cardExpiryMonth) < currentMonth && Number(cardExpiryYear) === currentYear) {
                $('#div_id_card_expiration_year .validation-error').append('<span>Card expired</span>');
                event.preventDefault();
            }
        },
        onReady = function() {
            var $paymentButtons = $('.payment-buttons'),
                basketId = $paymentButtons.data('basket-id'),
                iconPath = '/static/images/credit_cards/';

            $('#voucher_form_link').on('click', function(event) {
                event.preventDefault();
                showVoucherForm();
            });

            $('#voucher_form_cancel').on('click', function(event) {
                event.preventDefault();
                hideVoucherForm();
            });

            $('#id_card_number').on('input', function() {
                var cardNumber = $('#id_card_number').val().replace(/\s+/g, ''),
                    card;

                if (cardNumber.length > 12) {
                    card = Utils.getCreditCardType(cardNumber);

                    if (typeof card !== 'undefined') {
                        $('.card-type-icon').attr(
                            'src',
                            iconPath + card.name + '.png'
                        );
                        $('input[name=card_type]').val(card.type);
                    } else {
                        $('.card-type-icon').attr('src', '');
                        $('input[name=card_type]').val('');
                    }
                }
            });

            $('#payment-button').click(function(e) {
                cardInfoValidation(e);
            });

            $paymentButtons.find('.payment-button').click(function (e) {
                var $btn = $(e.target),
                    deferred = new $.Deferred(),
                    promise = deferred.promise(),
                    paymentProcessor = $btn.data('processor-name'),
                    data = {
                        basket_id: basketId,
                        payment_processor: paymentProcessor
                    };

                Utils.disableElementWhileRunning($btn, function() { return promise; });
                checkoutPayment(data);
            });

            // Increment the quantity field until max
            $('.spinner .btn:first-of-type').on('click', function() {
                var btn = $(this);
                var input = btn.closest('.spinner').find('input');
                // Stop if max attribute is defined and value is reached to given max value
                if (input.attr('max') === undefined || parseInt(input.val()) < parseInt(input.attr('max'))) {
                    input.val(parseInt(input.val()) + 1);
                } else {
                    btn.next('disabled', true);
                }
            });

            // Decrement the quantity field until min
            $('.spinner .btn:last-of-type').on('click', function() {
                var btn = $(this);
                var input = btn.closest('.spinner').find('input');
                // Stop if min attribute is defined and value is reached to given min value
                if (input.attr('min') === undefined || parseInt(input.val()) > parseInt(input.attr('min'))) {
                    input.val(parseInt(input.val()) - 1);
                } else {
                    btn.prev('disabled', true);
                }
            });
        },
        showVoucherForm = function() {
            $('#voucher_form_container').show();
            $('#voucher_form_link').hide();
            $('#id_code').focus();
        };

        return {
            appendToForm: appendToForm,
            checkoutPayment: checkoutPayment,
            hideVoucherForm: hideVoucherForm,
            onSuccess: onSuccess,
            onFail: onFail,
            onReady: onReady,
            showVoucherForm: showVoucherForm,
        };
    }
);

""" Checkout related views. """
from __future__ import unicode_literals

from decimal import Decimal

import dateutil.parser
from django.contrib.auth.decorators import login_required
from django.http import Http404
from django.shortcuts import get_object_or_404
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
from django.views.generic import RedirectView, TemplateView
from oscar.apps.checkout.views import *  # pylint: disable=wildcard-import, unused-wildcard-import
from oscar.core.loading import get_class, get_model

from ecommerce.core.url_utils import get_lms_url
from ecommerce.extensions.api.serializers import OrderSerializer
from ecommerce.extensions.checkout.exceptions import BasketNotFreeError
from ecommerce.extensions.checkout.mixins import EdxOrderPlacementMixin
from ecommerce.extensions.checkout.utils import get_receipt_page_url

Applicator = get_class('offer.utils', 'Applicator')
Basket = get_model('basket', 'Basket')
Order = get_model('order', 'Order')


class FreeCheckoutView(EdxOrderPlacementMixin, RedirectView):
    """ View to handle free checkouts.

    Retrieves the user's basket and checks to see if the basket is free in which case
    the user is redirected to the receipt page. Otherwise the user is redirected back
    to the basket summary page.
    """

    permanent = False

    @method_decorator(login_required)
    def dispatch(self, *args, **kwargs):
        return super(FreeCheckoutView, self).dispatch(*args, **kwargs)

    def get_redirect_url(self, *args, **kwargs):
        basket = Basket.get_basket(self.request.user, self.request.site)
        if not basket.is_empty:
            # Need to re-apply the voucher to the basket.
            Applicator().apply(basket, self.request.user, self.request)
            if basket.total_incl_tax != Decimal(0):
                raise BasketNotFreeError("Basket is not free.")

            order = self.place_free_order(basket)
            receipt_path = get_receipt_page_url(
                order_number=order.number,
                site_configuration=order.site.siteconfiguration
            )
            url = get_lms_url(receipt_path)
        else:
            # If a user's basket is empty redirect the user to the basket summary
            # page which displays the appropriate message for empty baskets.
            url = reverse('basket:summary')
        return url


class CancelCheckoutView(TemplateView):
    """
    Displays a cancellation message when the customer cancels checkout on the
    payment processor page.
    """

    template_name = 'checkout/cancel_checkout.html'

    @method_decorator(csrf_exempt)
    def dispatch(self, *args, **kwargs):
        """
        Request needs to be csrf_exempt to handle POST back from external payment processor.
        """
        return super(CancelCheckoutView, self).dispatch(*args, **kwargs)

    def post(self, request, *args, **kwargs):  # pylint: disable=unused-argument
        """
        Allow POST responses from payment processors and just render the cancel page..
        """
        context = self.get_context_data(**kwargs)
        return self.render_to_response(context)

    def get_context_data(self, **kwargs):
        context = super(CancelCheckoutView, self).get_context_data(**kwargs)
        context.update({
            'payment_support_email': self.request.site.siteconfiguration.payment_support_email,
        })
        return context


class CheckoutErrorView(TemplateView):
    """ Displays an error page when checkout does not complete successfully. """

    template_name = 'checkout/error.html'

    @method_decorator(csrf_exempt)
    def dispatch(self, *args, **kwargs):
        """
        Request needs to be csrf_exempt to handle POST back from external payment processor.
        """
        return super(CheckoutErrorView, self).dispatch(*args, **kwargs)

    def post(self, request, *args, **kwargs):  # pylint: disable=unused-argument
        """
        Allow POST responses from payment processors and just render the error page.
        """
        context = self.get_context_data(**kwargs)
        return self.render_to_response(context)

    def get_context_data(self, **kwargs):
        context = super(CheckoutErrorView, self).get_context_data(**kwargs)
        context.update({
            'payment_support_email': self.request.site.siteconfiguration.payment_support_email,
        })
        return context


class ReceiptResponseView(ThankYouView):
    """ Handles behavior needed to display an order receipt. """
    template_name = 'edx/checkout/receipt.html'

    @method_decorator(csrf_exempt)
    @method_decorator(login_required)
    def dispatch(self, *args, **kwargs):
        """
        Customers should only be able to view their receipts when logged in. To avoid blocking responses
        from payment processors which POST back to the page, the view must be CSRF-exempt.
        """
        return super(ReceiptResponseView, self).dispatch(*args, **kwargs)

    def get(self, request, *args, **kwargs):
        try:
            return super(ReceiptResponseView, self).get(request, *args, **kwargs)
        except Http404:
            self.template_name = 'edx/checkout/receipt_not_found.html'
            context = {
                'order_history_url': request.site.siteconfiguration.build_lms_url('account/settings'),
            }
            return self.render_to_response(context=context, status=404)

    def get_context_data(self, **kwargs):
        context = super(ReceiptResponseView, self).get_context_data(**kwargs)
        order = context[self.context_object_name]
        context.update({
            'name': '{} {}'.format(self.request.user.first_name, self.request.user.last_name),
            'payment_method': self.get_payment_method(order),
            'payment_successful': self.request.session.pop('payment_successful', None),
        })
        self.update_context_with_order_data(context)
        return context

    def get_object(self):
        kwargs = {
            'site': self.request.site,
            'number': self.request.GET['order_number'],
        }

        user = self.request.user
        if not user.is_staff:
            kwargs['user'] = user

        return get_object_or_404(Order, **kwargs)

    def get_payment_method(self, order):
        # TODO Account for non-credit card payments
        source = order.sources.first()
        return '{type} {number}'.format(type=source.get_card_type_display(), number=source.label)

    def update_context_with_order_data(self, context):
        """
        Updates the context dictionary with Order data.

        Args:
            context (dict): Context dictionary returned with the Response.
        """
        order = context[self.context_object_name]
        site_configuration = self.request.site.siteconfiguration

        verification_data = {}
        credit_providers = set()
        verified_course_id = None

        # NOTE: Only display verification and credit completion details to the user who actually placed the order.
        if self.request.user == order.user:
            for line in order.lines.all():
                product = line.product

                credit_provider = getattr(product.attr, 'credit_provider', None)
                if credit_provider:
                    credit_providers.add(credit_provider)

                if not verified_course_id and getattr(product.attr, 'id_verification_required', False):
                    verified_course_id = product.attr.course_key

            if credit_providers:
                try:
                    # TODO Figure out a way to cache credit provider data for...24 hours.
                    credit_providers = site_configuration.credit_api_client.providers().get(
                        provider_ids=','.join(credit_providers)
                    )
                    credit_providers = {provider['id']: provider for provider in credit_providers}
                    # TODO Attach credit provider info to the relevant order lines. The "beauty" of Python!
                except:
                    # TODO Set a flag to trigger an error display to the user.
                    logger.exception('Failed to retrieve credit provider details.')

            if verified_course_id:
                context.update({
                    'verified_course_id': verified_course_id,
                    'user_verified': self.request.user.is_verified(self.request),
                })

        order_data = OrderSerializer(order, context={'request': self.request}).data

        context.update({
            'order_data': order_data,
            'providers': credit_providers,
        })

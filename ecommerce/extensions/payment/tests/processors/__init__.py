from ecommerce.extensions.payment.processors import BasePaymentProcessor, HandledProcessorResponse


class DummyProcessor(BasePaymentProcessor):
    NAME = 'dummy'
    REFUND_TRANSACTION_ID = 'fake-refund'

    def get_transaction_parameters(self, basket, request=None, use_client_side_checkout=False, **kwargs):
        pass

    def handle_processor_response(self, response, basket=None):
        return HandledProcessorResponse(
            transaction_id=basket.id,
            total=basket.total_incl_tax,
            currency=basket.currency,
            card_number=basket.owner.username,
            card_type=None
        )

    def is_signature_valid(self, response):
        pass

    def issue_credit(self, order, reference_number, amount, currency):
        return self.REFUND_TRANSACTION_ID


class AnotherDummyProcessor(DummyProcessor):
    NAME = 'another-dummy'
